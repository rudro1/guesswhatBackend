import mongoose from 'mongoose';

const connectMongoDB = async () => {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGODB_URI environment variable is not set');
    }

    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000
    });

    console.log('[MongoDB] Connected to Atlas');

    mongoose.connection.on('error', (err) => {
      console.error('[MongoDB] Connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('[MongoDB] Disconnected. Attempting reconnect...');
    });
  } catch (error) {
    console.error('[MongoDB] Initial connection failed:', error.message);
    process.exit(1);
  }
};

export default connectMongoDB;
