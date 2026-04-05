import express from 'express';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import prisma from '../config/prisma.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

const parseXmlToConfig = (xmlString) => {
  const validator = XMLValidator.validate(xmlString);
  if (validator !== true) {
    throw new Error(`XML validation error: ${validator.err.msg} at line ${validator.err.line}`);
  }

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });
  const parsed = parser.parse(xmlString);
  const tmpl = parsed.template;

  if (!tmpl) throw new Error('Root <template> element not found');

  const categories = [];
  const rawCats = tmpl.categories?.category;
  if (rawCats) {
    const catArr = Array.isArray(rawCats) ? rawCats : [rawCats];
    catArr.forEach((cat) => {
      categories.push({
        value: cat['@_value'],
        visible: cat['@_visible'] !== 'false',
        color: cat['@_color'] || '#6B7280'
      });
    });
  }

  const defaultFields = {};
  const rawDefault = tmpl.defaultFields?.field;
  if (rawDefault) {
    const defArr = Array.isArray(rawDefault) ? rawDefault : [rawDefault];
    defArr.forEach((f) => {
      defaultFields[f['@_name']] = {
        visible: f['@_visible'] !== 'false',
        required: f['@_required'] === 'true',
        showFor: f['@_showFor'] || 'all'
      };
    });
  }

  const fillerWords = [];
  const rawFillers = tmpl.fillerWords;
  if (rawFillers) {
    const wordArr = Array.isArray(rawFillers.word) ? rawFillers.word : rawFillers.word ? [rawFillers.word] : [];
    wordArr.forEach((w) => {
      fillerWords.push({ value: w['@_value'], insertAs: w['@_insertAs'] });
    });
  }
  const allowCustomFiller = rawFillers?.allowCustom !== 'false';

  const customFields = [];
  const rawCustom = tmpl.customFields?.field;
  if (rawCustom) {
    const fieldArr = Array.isArray(rawCustom) ? rawCustom : [rawCustom];
    fieldArr.forEach((f) => {
      const field = {
        type: f['@_type'],
        name: f['@_name'],
        label: f['@_label'],
        required: f['@_required'] === 'true',
        showFor: f['@_showFor'] || 'all'
      };

      if (f['@_placeholder']) field.placeholder = f['@_placeholder'];
      if (f['@_maxStars']) field.maxStars = parseInt(f['@_maxStars'], 10);
      if (f['@_min'] !== undefined) field.min = parseFloat(f['@_min']);
      if (f['@_max'] !== undefined) field.max = parseFloat(f['@_max']);
      if (f['@_step'] !== undefined) field.step = parseFloat(f['@_step']);
      if (f['@_defaultValue'] !== undefined) field.defaultValue = f['@_defaultValue'];

      const rawOpts = f.option;
      if (rawOpts) {
        const opts = Array.isArray(rawOpts) ? rawOpts : [rawOpts];
        field.options = opts.map((o) => ({
          value: o['@_value'],
          label: typeof o === 'string' ? o : o['#text'] || o['@_value']
        }));
      }

      customFields.push(field);
    });
  }

  const waveform = {
    minSegmentDuration: parseFloat(tmpl.waveform?.minSegmentDuration || '0.15'),
    defaultZoom: parseInt(tmpl.waveform?.defaultZoom || '50', 10),
    playbackSpeeds: (tmpl.waveform?.playbackSpeeds || '0.5,1,1.5,2').split(',').map(parseFloat)
  };

  return { name: tmpl['@_name'] || 'Custom Template', categories, defaultFields, fillerWords, allowCustomFiller, customFields, waveform };
};

// Get all templates
router.get('/', authenticate, async (req, res, next) => {
  try {
    const templates = await prisma.template.findMany({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }]
    });
    res.json(templates);
  } catch (error) {
    next(error);
  }
});

router.get('/default/active', authenticate, async (req, res, next) => {
  try {
    const template = await prisma.template.findFirst({ where: { isDefault: true } });
    if (!template) return res.status(404).json({ error: 'No default template set' });
    res.json(template);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const template = await prisma.template.findUnique({ where: { id: req.params.id } });
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.json(template);
  } catch (error) {
    next(error);
  }
});

// Create template (admin only)
router.post('/', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { name, description, xmlConfig } = req.body;

    if (!name || !xmlConfig) {
      return res.status(400).json({ error: 'name and xmlConfig are required' });
    }

    let parsedConfig;
    try {
      parsedConfig = parseXmlToConfig(xmlConfig);
    } catch (err) {
      return res.status(400).json({ error: `XML validation failed: ${err.message}` });
    }

    const template = await prisma.template.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        xmlConfig,
        parsedConfig,
        createdBy: req.user.userId
      }
    });

    res.status(201).json(template);
  } catch (error) {
    next(error);
  }
});

// Update template (admin only)
router.put('/:id', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { name, description, xmlConfig } = req.body;
    const { id } = req.params;

    let parsedConfig;
    if (xmlConfig) {
      try {
        parsedConfig = parseXmlToConfig(xmlConfig);
      } catch (err) {
        return res.status(400).json({ error: `XML validation failed: ${err.message}` });
      }
    }

    const template = await prisma.template.update({
      where: { id },
      data: {
        ...(name && { name: name.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(xmlConfig && { xmlConfig }),
        ...(parsedConfig && { parsedConfig })
      }
    });

    res.json(template);
  } catch (error) {
    next(error);
  }
});

// Set as default (admin only)
router.post('/:id/default', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    await prisma.template.updateMany({ data: { isDefault: false } });
    const template = await prisma.template.update({ where: { id: req.params.id }, data: { isDefault: true } });
    res.json(template);
  } catch (error) {
    next(error);
  }
});

// Duplicate template (admin only)
router.post('/:id/copy', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const original = await prisma.template.findUnique({ where: { id: req.params.id } });
    if (!original) return res.status(404).json({ error: 'Template not found' });

    const copy = await prisma.template.create({
      data: {
        name: `${original.name} (Copy)`,
        description: original.description,
        xmlConfig: original.xmlConfig,
        parsedConfig: original.parsedConfig,
        createdBy: req.user.userId,
        isDefault: false,
        usageCount: 0
      }
    });

    res.status(201).json(copy);
  } catch (error) {
    next(error);
  }
});

// Delete template (admin only, only if usageCount === 0)
router.delete('/:id', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const template = await prisma.template.findUnique({ where: { id: req.params.id } });
    if (!template) return res.status(404).json({ error: 'Template not found' });

    if (template.isDefault) {
      return res.status(400).json({ error: 'Cannot delete the default template' });
    }

    if (template.usageCount > 0) {
      return res.status(400).json({ error: 'Cannot delete a template that is in use' });
    }

    await prisma.template.delete({ where: { id: req.params.id } });
    res.json({ message: 'Template deleted' });
  } catch (error) {
    next(error);
  }
});

// Validate XML without saving
router.post('/validate', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { xmlConfig } = req.body;
    if (!xmlConfig) return res.status(400).json({ error: 'xmlConfig is required' });

    try {
      const parsed = parseXmlToConfig(xmlConfig);
      res.json({ valid: true, parsedConfig: parsed });
    } catch (err) {
      res.json({ valid: false, error: err.message });
    }
  } catch (error) {
    next(error);
  }
});

export default router;
