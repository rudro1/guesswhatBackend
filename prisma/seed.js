import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  const adminPassword = await bcrypt.hash('admin123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@guesswhat.com' },
    update: {},
    create: {
      email: 'admin@guesswhat.com',
      password: adminPassword,
      name: 'Admin User',
      role: 'ADMIN',
    },
  });
  console.log('Created admin:', admin.email);

  const annotatorPassword = await bcrypt.hash('annotator123', 12);
  const annotator = await prisma.user.upsert({
    where: { email: 'annotator@guesswhat.com' },
    update: {},
    create: {
      email: 'annotator@guesswhat.com',
      password: annotatorPassword,
      name: 'Demo Annotator',
      role: 'ANNOTATOR',
    },
  });
  console.log('Created annotator:', annotator.email);

  const reviewerPassword = await bcrypt.hash('reviewer123', 12);
  const reviewer = await prisma.user.upsert({
    where: { email: 'reviewer@guesswhat.com' },
    update: {},
    create: {
      email: 'reviewer@guesswhat.com',
      password: reviewerPassword,
      name: 'Demo Reviewer',
      role: 'REVIEWER',
    },
  });
  console.log('Created reviewer:', reviewer.email);

  // Create default template
  const defaultXml = `<?xml version="1.0" encoding="UTF-8"?>
<template name="Default Template" version="1.0">
  <categories>
    <category value="Speech" visible="true" color="#3B82F6"/>
    <category value="Noise" visible="true" color="#EF4444"/>
    <category value="Silence" visible="true" color="#6B7280"/>
    <category value="Overlap" visible="true" color="#F59E0B"/>
    <category value="Music" visible="true" color="#8B5CF6"/>
    <category value="Inaudible" visible="true" color="#EC4899"/>
  </categories>
  <defaultFields>
    <field name="speaker" visible="true" required="false" showFor="Speech"/>
    <field name="transcription" visible="true" required="false" showFor="Speech"/>
    <field name="fillerWords" visible="true" showFor="Speech"/>
  </defaultFields>
  <fillerWords>
    <word value="um" insertAs="#um"/>
    <word value="ah" insertAs="#ah"/>
    <word value="like" insertAs="#like"/>
    <word value="uh" insertAs="#uh"/>
    <word value="you know" insertAs="#youknow"/>
    <allowCustom>true</allowCustom>
  </fillerWords>
  <customFields/>
  <waveform>
    <minSegmentDuration>0.15</minSegmentDuration>
    <defaultZoom>50</defaultZoom>
    <playbackSpeeds>0.5,1,1.5,2</playbackSpeeds>
  </waveform>
</template>`;

  const existing = await prisma.template.findFirst({ where: { isDefault: true } });
  if (!existing) {
    await prisma.template.create({
      data: {
        name: 'Default Template',
        description: 'Standard annotation template with speech categories',
        xmlConfig: defaultXml,
        parsedConfig: {
          name: 'Default Template',
          categories: [
            { value: 'Speech', visible: true, color: '#3B82F6' },
            { value: 'Noise', visible: true, color: '#EF4444' },
            { value: 'Silence', visible: true, color: '#6B7280' },
            { value: 'Overlap', visible: true, color: '#F59E0B' },
            { value: 'Music', visible: true, color: '#8B5CF6' },
            { value: 'Inaudible', visible: true, color: '#EC4899' },
          ],
          defaultFields: {
            speaker: { visible: true, required: false, showFor: 'Speech' },
            transcription: { visible: true, required: false, showFor: 'Speech' },
            fillerWords: { visible: true, showFor: 'Speech' },
          },
          fillerWords: [
            { value: 'um', insertAs: '#um' },
            { value: 'ah', insertAs: '#ah' },
            { value: 'like', insertAs: '#like' },
            { value: 'uh', insertAs: '#uh' },
            { value: 'you know', insertAs: '#youknow' },
          ],
          allowCustomFiller: true,
          customFields: [],
          waveform: { minSegmentDuration: 0.15, defaultZoom: 50, playbackSpeeds: [0.5, 1, 1.5, 2] },
        },
        createdBy: admin.id,
        isDefault: true,
      },
    });
    console.log('Created default template');
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
