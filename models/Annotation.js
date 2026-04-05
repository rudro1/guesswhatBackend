import mongoose from 'mongoose';

const FillerWordSchema = new mongoose.Schema({
  word: { type: String, required: true },
  position: { type: Number, required: true },
  insertedAt: { type: Date, default: Date.now }
}, { _id: false });

const ReviewChangeSchema = new mongoose.Schema({
  reviewerId: { type: String, required: true },
  reviewerName: { type: String, default: '' },
  field: { type: String, required: true },
  oldValue: { type: mongoose.Schema.Types.Mixed },
  newValue: { type: mongoose.Schema.Types.Mixed },
  changedAt: { type: Date, default: Date.now }
}, { _id: false });

const SegmentSchema = new mongoose.Schema({
  segmentId: { type: String, required: true },
  startTime: { type: Number, required: true },
  endTime: { type: Number, required: true },
  category: { type: String, required: true },
  speaker: { type: String },
  transcription: { type: String },
  fillerWords: { type: [FillerWordSchema], default: [] },
  dynamicFields: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
  annotatedBy: { type: String },
  annotatedAt: { type: Date },
  reviewChanges: { type: [ReviewChangeSchema], default: [] }
}, { _id: false });

const AnnotationSchema = new mongoose.Schema({
  taskId: { type: Number, required: true, unique: true, index: true },
  isValid: { type: Boolean, default: true },
  annotatorId: { type: String, required: true },
  annotatorEmail: { type: String },
  annotatorName: { type: String },
  reviewerId: { type: String },
  reviewerEmail: { type: String },
  reviewerName: { type: String },
  templateId: { type: String },
  segments: { type: [SegmentSchema], default: [] },
  status: {
    type: String,
    enum: ['DRAFT', 'SUBMITTED', 'REVIEWED'],
    default: 'DRAFT'
  },
  submittedAt: { type: Date },
  reviewedAt: { type: Date },
  exportedAt: { type: Date }
}, { timestamps: true });

export default mongoose.model('Annotation', AnnotationSchema);
