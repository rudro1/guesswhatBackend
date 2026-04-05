import mongoose from 'mongoose';

const AccessRequestSchema = new mongoose.Schema({
  name:      { type: String, required: true, trim: true },
  email:     { type: String, required: true, trim: true, lowercase: true },
  role:      { type: String, enum: ['ANNOTATOR', 'REVIEWER'], default: 'ANNOTATOR' },
  note:      { type: String, default: '' },
  status:    { type: String, enum: ['PENDING', 'APPROVED', 'DISMISSED'], default: 'PENDING' },
}, { timestamps: true });

export default mongoose.model('AccessRequest', AccessRequestSchema);