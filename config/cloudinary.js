import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

/**
 * Upload a file to Cloudinary without ANY modification.
 * resource_type must be 'video' for audio files in Cloudinary.
 */
export const uploadToCloudinary = (filePath, publicId) => {
  if (!filePath || typeof filePath !== 'string') {
    return Promise.reject(new TypeError('uploadToCloudinary: filePath must be a non-empty string'));
  }
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      filePath,
      {
        resource_type: 'video',
        public_id: publicId,
        use_filename: true,
        unique_filename: false,
        overwrite: false,
        // CRITICAL: No transformation - upload as-is
        invalidate: false
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
  });
};

export default cloudinary;
