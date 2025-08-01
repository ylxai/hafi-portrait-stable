import { supabaseAdmin } from './supabase'; // Pastikan ini diimpor dengan benar
import { ImageOptimizerServer } from './image-optimizer-server';

// Definisi Tipe Data untuk konsistensi
export type Event = {
  id: string;
  name: string;
  date: string;
  access_code: string | null;
  is_premium: boolean;
  qr_code: string | null;
  shareable_link: string | null;
};

export type Photo = {
  id: string;
  event_id?: string | null; // Opsional karena bisa jadi foto homepage
  url: string;
  thumbnail_url: string | null;
  uploaded_at: string;
  is_homepage: boolean | null; // Tambahkan ini jika belum ada
  original_name: string;
  uploader_name?: string | null;
  album_name?: string | null;
  filename?: string | null; // Tambahkan filename jika required
  optimized_images?: OptimizedImages | null;
  image_metadata?: ImageMetadata | null;
  compression_stats?: CompressionStats | null;
};

export type OptimizedImages = {
  original: { url: string; size: number; width?: number; height?: number; };
  thumbnail: { url: string; size: number; };
  small: { url: string; size: number; };
  medium: { url: string; size: number; };
  large: { url: string; size: number; };
};

export type ImageMetadata = {
  width: number;
  height: number;
  format: string;
  original_size: number;
};

export type CompressionStats = {
  original_size: string;
  optimized_size: string;
  savings: number;
  ratio: string;
};

export type Message = {
  id: string;
  event_id: string;
  sender_name: string;
  content: string;
  sent_at: string;
  hearts: number;
  guest_name?: string; // Add guest_name as optional for compatibility
};

export type Stats = {
  totalEvents: number;
  totalPhotos: number;
  totalMessages: number;
};

class DatabaseService {
  private supabase: typeof supabaseAdmin;
  private imageOptimizer: ImageOptimizerServer;

  constructor() {
    this.supabase = supabaseAdmin;
    this.imageOptimizer = new ImageOptimizerServer(this.supabase, 'photos');
  }

  // --- Metode Event ---
  async getAllEvents(): Promise<Event[]> {
    const { data, error } = await this.supabase
      .from('events')
      .select('*')
      .order('date', { ascending: false });
    if (error) throw error;
    return data;
  }

  async getPublicEvents(): Promise<Event[]> {
    const { data, error } = await this.supabase
      .from('events')
      .select('id, name, date, is_premium, qr_code, shareable_link')
      .is('is_premium', false) // Asumsi hanya event non-premium yang publik, sesuaikan jika perlu
      .order('date', { ascending: false });
    if (error) throw error;
    return data;
  }

  async getEventById(id: string): Promise<Event | null> {
    const { data, error } = await this.supabase
      .from('events')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  }

  async createEvent(event: Omit<Event, 'id' | 'qr_code' | 'shareable_link'>): Promise<Event> {
    // First, insert the event to get the ID
    const { data: newEvent, error } = await this.supabase
      .from('events')
      .insert(event)
      .select()
      .single();
    
    if (error) throw error;
    
    try {
      // Generate QR code and shareable link
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const eventUrl = `${baseUrl}/event/${newEvent.id}?code=${newEvent.access_code}`;
      
      // Generate QR code using a service like QRServer.com
      const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(eventUrl)}`;
      
      // Update the event with QR code and shareable link
      const { data: updatedEvent, error: updateError } = await this.supabase
        .from('events')
        .update({
          qr_code: qrCodeUrl,
          shareable_link: eventUrl
        })
        .eq('id', newEvent.id)
        .select()
        .single();
      
      if (updateError) throw updateError;
      return updatedEvent;
    } catch (updateError) {
      console.error('Error generating QR code:', updateError);
      // Return the event even if QR code generation fails
      return newEvent;
    }
  }

  async updateEvent(id: string, updates: Partial<Event>): Promise<Event> {
    const { data, error } = await this.supabase
      .from('events')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async deleteEvent(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('events')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }

  async verifyEventAccessCode(eventId: string, code: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('events')
      .select('id')
      .eq('id', eventId)
      .eq('access_code', code)
      .single();
    if (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Error verifying access code:', error);
      }
      return false;
    }
    return !!data;
  }

  // --- Metode Foto ---
  async getEventPhotos(eventId: string): Promise<Photo[]> {
    const { data, error } = await this.supabase
      .from('photos')
      .select('*')
      .eq('event_id', eventId)
      .order('uploaded_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async getHomepagePhotos(): Promise<Photo[]> {
    const { data, error } = await this.supabase
      .from('photos')
      .select('*')
      .eq('is_homepage', true) // Asumsi kolom ini ada di tabel photos
      .order('uploaded_at', { ascending: false });
    if (error) {
      // Log error yang lebih spesifik jika kolom tidak ditemukan
      if (error.code === '42P01') { // PostgreSQL error code for undefined_table
        if (process.env.NODE_ENV === 'development') {
          console.error("Database Error: Column 'is_homepage' does not exist. Please add it to your 'photos' table.");
        }
      }
      throw error;
    }
    return data;
  }

  private validateFileExtension(filename: string): boolean {
    const allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    const ext = filename.split('.').pop()?.toLowerCase();
    return ext ? allowedExtensions.includes(ext) : false;
  }

  private generateFileName(originalName: string): string {
    const fileExt = originalName.split('.').pop()?.toLowerCase() || 'jpg';
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    return `${timestamp}_${randomStr}.${fileExt}`;
  }

  async getEvents(): Promise<Event[]> {
    const { data, error } = await this.supabase
      .from('events')
      .select('*')
      .order('date', { ascending: false });
    
    if (error) throw error;
    return data || [];
  }

  async getSimpleCompressionAnalytics() {
    try {
      // Get photos with compression data (simplified version)
      const { data: photos, error: photosError } = await this.supabase
        .from('photos')
        .select('*')
        .not('optimized_images', 'is', null)
        .order('uploaded_at', { ascending: false })
        .limit(100); // Limit to recent 100 photos

      if (photosError) throw photosError;

      // Calculate simple analytics
      const totalPhotos = photos?.length || 0;
      let totalOriginalSize = 0;
      let totalOptimizedSize = 0;
      let totalSavingsBytes = 0;

      const recentPhotos: any[] = [];

      photos?.forEach(photo => {
        if (photo.image_metadata && photo.optimized_images) {
          const originalSize = photo.image_metadata.original_size || 0;
          const optimizedSize = photo.optimized_images.medium?.size || 0;
          const savings = originalSize - optimizedSize;
          const savingsPercentage = originalSize > 0 ? (savings / originalSize) * 100 : 0;

          totalOriginalSize += originalSize;
          totalOptimizedSize += optimizedSize;
          totalSavingsBytes += savings;

          // Recent photos (top 10)
          if (recentPhotos.length < 10) {
            recentPhotos.push({
              id: photo.id,
              original_name: photo.original_name,
              original_size: originalSize,
              optimized_size: optimizedSize,
              savings_percentage: savingsPercentage,
              uploaded_at: photo.uploaded_at
            });
          }
        }
      });

      const totalSavingsPercentage = totalOriginalSize > 0 ? (totalSavingsBytes / totalOriginalSize) * 100 : 0;
      const averageCompressionRatio = totalOptimizedSize > 0 ? totalOriginalSize / totalOptimizedSize : 1;

      return {
        totalPhotos,
        totalOriginalSize,
        totalOptimizedSize,
        totalSavingsBytes,
        totalSavingsPercentage,
        storageSaved: this.formatFileSize(totalSavingsBytes),
        averageCompressionRatio,
        recentPhotos: recentPhotos.sort((a, b) => b.savings_percentage - a.savings_percentage)
      };
    } catch (error) {
      console.error('Error getting simple compression analytics:', error);
      throw error;
    }
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async validateEventAccess(eventId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('events')
      .select('id, is_premium')
      .eq('id', eventId)
      .single();
    
    if (error || !data) {
      throw new Error('Event not found');
    }
    return true;
  }

  async uploadEventPhoto(eventId: string, file: File, uploaderName: string = 'Anonymous', albumName: string = 'Tamu'): Promise<Photo> {
    // Validate eventId exists
    await this.validateEventAccess(eventId);

    // Validate file extension
    if (!this.validateFileExtension(file.name)) {
      throw new Error('Invalid file type. Allowed: jpg, jpeg, png, gif, webp');
    }

    try {
      // Convert File to Buffer for server-side processing
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      // Process image with optimization (server-side)
      const optimizedImages = await this.imageOptimizer.processImage(buffer, file.name, `events/${eventId}`);
      
      // Get image metadata
      const sharp = (await import('sharp')).default;
      const metadata = await sharp(buffer).metadata();
      
      const imageMetadata = {
        width: metadata.width || 0,
        height: metadata.height || 0,
        format: metadata.format || 'jpeg',
        original_size: buffer.length
      };

      // Calculate compression stats
      const compressionStats = ImageOptimizerServer.getCompressionStats(optimizedImages);

      const { data: photoData, error: insertError } = await this.supabase
        .from('photos')
        .insert({ 
          event_id: eventId,
          url: optimizedImages.original.url, // Keep original URL for backward compatibility
          thumbnail_url: optimizedImages.thumbnail.url,
          original_name: file.name,
          uploader_name: uploaderName,
          album_name: albumName,
          is_homepage: false,
          filename: this.generateFileName(file.name),
          optimized_images: optimizedImages,
          image_metadata: imageMetadata,
          compression_stats: compressionStats
        })
        .select()
        .single();

      if (insertError) throw insertError;
      return photoData;
    } catch (error) {
      console.error('Error uploading optimized event photo:', error);
      throw error;
    }
  }

  async uploadHomepagePhoto(file: File): Promise<Photo> {
    // Validate file extension
    if (!this.validateFileExtension(file.name)) {
      throw new Error('Invalid file type. Allowed: jpg, jpeg, png, gif, webp');
    }

    try {
      // Convert File to Buffer for server-side processing
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      // Process image with optimization (server-side)
      const optimizedImages = await this.imageOptimizer.processImage(buffer, file.name, 'homepage');
      
      // Get image metadata
      const sharp = (await import('sharp')).default;
      const metadata = await sharp(buffer).metadata();
      
      const imageMetadata = {
        width: metadata.width || 0,
        height: metadata.height || 0,
        format: metadata.format || 'jpeg',
        original_size: buffer.length
      };

      // Calculate compression stats
      const compressionStats = ImageOptimizerServer.getCompressionStats(optimizedImages);

      const { data: photoData, error: insertError } = await this.supabase
        .from('photos')
        .insert({ 
          url: optimizedImages.original.url, // Keep original URL for backward compatibility
          thumbnail_url: optimizedImages.thumbnail.url,
          original_name: file.name,
          is_homepage: true,
          event_id: null,
          uploader_name: 'Admin',
          album_name: 'Homepage',
          filename: this.generateFileName(file.name),
          optimized_images: optimizedImages,
          image_metadata: imageMetadata,
          compression_stats: compressionStats
        })
        .select()
        .single();

      if (insertError) throw insertError;
      return photoData;
    } catch (error) {
      console.error('Error uploading optimized homepage photo:', error);
      throw error;
    }
  }


  async getPhotoById(photoId: string): Promise<Photo | null> {
    const { data, error } = await this.supabase
      .from('photos')
      .select('*')
      .eq('id', photoId)
      .single();
    
    if (error) throw error;
    return data;
  }

  async deletePhoto(photoId: string): Promise<void> {
    // Get photo details
    const photo = await this.getPhotoById(photoId);
    if (!photo) {
      throw new Error('Photo not found');
    }

    try {
      // Extract file path from URL or use stored filename
      let filePath: string;
      
      if (photo.filename) {
        // Use stored filename if available
        if (photo.is_homepage) {
          filePath = `homepage/${photo.filename}`;
        } else if (photo.event_id) {
          filePath = `events/${photo.event_id}/${photo.filename}`;
        } else {
          // Fallback if structure is unclear
          filePath = photo.filename;
        }
      } else {
        // Extract from URL as fallback
        const urlParts = photo.url.split('/');
        const fileName = urlParts[urlParts.length - 1];
        
        if (photo.is_homepage) {
          filePath = `homepage/${fileName}`;
        } else if (photo.event_id) {
          filePath = `events/${photo.event_id}/${fileName}`;
        } else {
          // Fallback if structure is unclear
          filePath = fileName;
        }
      }

      // Delete from storage first
      const { error: deleteStorageError } = await this.supabase.storage
        .from('photos')
        .remove([filePath]);

      if (deleteStorageError) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Error deleting file from storage:', deleteStorageError);
        }
        // Continue with database deletion even if storage deletion fails
      }

      // Then delete from database
      const { error: deleteDbError } = await this.supabase
        .from('photos')
        .delete()
        .eq('id', photoId);

      if (deleteDbError) throw deleteDbError;
    } catch (error) {
      // If it's not a storage error, rethrow
      if (error instanceof Error && !error.message.includes('storage')) {
        throw error;
      }
      
      // For storage errors, try to delete from database anyway
      const { error: deleteDbError } = await this.supabase
        .from('photos')
        .delete()
        .eq('id', photoId);
        
      if (deleteDbError) throw deleteDbError;
    }
  }

  async likePhoto(photoId: string): Promise<void> {
    const { data, error } = await this.supabase.rpc('increment_likes', { photo_id: photoId }); // Panggil fungsi RPC
    if (error) throw error;
  }


  // --- Metode Pesan ---
  async getEventMessages(eventId: string): Promise<Message[]> {
    const { data, error } = await this.supabase
      .from('messages')
      .select('*')
      .eq('event_id', eventId)
      .order('sent_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async createMessage(message: Omit<Message, 'id' | 'sent_at' | 'hearts'>): Promise<Message> {
    const { data, error } = await this.supabase
      .from('messages')
      .insert(message)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async heartMessage(messageId: string): Promise<void> {
    const { data, error } = await this.supabase.rpc('increment_hearts', { message_id: messageId }); // Panggil fungsi RPC
    if (error) throw error;
  }

  // --- Metode Statistik ---
  async getStats(): Promise<Stats> {
    const { count: totalEvents, error: eventsError } = await this.supabase
      .from('events')
      .select('*', { count: 'exact', head: true });
    if (eventsError) throw eventsError;

    const { count: totalPhotos, error: photosError } = await this.supabase
      .from('photos')
      .select('*', { count: 'exact', head: true });
    if (photosError) throw photosError;

    const { count: totalMessages, error: messagesError } = await this.supabase
      .from('messages')
      .select('*', { count: 'exact', head: true });
    if (messagesError) throw messagesError;

    return {
      totalEvents: totalEvents || 0,
      totalPhotos: totalPhotos || 0,
      totalMessages: totalMessages || 0,
    };
  }
}

export const database = new DatabaseService(); 