import { Expo, ExpoPushMessage, ExpoPushTicket, ExpoPushReceiptId } from 'expo-server-sdk';
import { logger } from '@/utils/logger';
import { userService } from '@/services/user.service';

export class NotificationService {
  private expo: Expo;

  constructor() {
    this.expo = new Expo({
      accessToken: process.env.EXPO_ACCESS_TOKEN, // Optional: for higher rate limits
    });
  }

  async registerPushToken(userId: number, pushToken: string): Promise<boolean> {
    try {
      // Validate the push token
      if (!Expo.isExpoPushToken(pushToken)) {
        logger.warn('Invalid Expo push token provided', {
          operation: 'registerPushToken',
          userId,
          tokenPrefix: pushToken.substring(0, 20),
        });
        return false;
      }

      // Save token to user record
      await userService.updateUser(userId, { 
        pushNotificationToken: pushToken 
      });

      logger.info('Push notification token registered successfully', {
        operation: 'registerPushToken',
        userId,
        tokenPrefix: pushToken.substring(0, 20),
      });

      return true;
    } catch (error) {
      logger.error('Failed to register push token', error as Error, {
        operation: 'registerPushToken',
        userId,
      });
      return false;
    }
  }

  async sendWorkoutCompletionNotification(
    userId: number,
    workoutName: string,
    workoutId: number
  ): Promise<boolean> {
    try {
      const user = await userService.getUserById(userId);
      
      if (!user?.pushNotificationToken) {
        logger.info('No push token found for user, skipping notification', {
          operation: 'sendWorkoutCompletionNotification',
          userId,
        });
        return false;
      }

      const message: ExpoPushMessage = {
        to: user.pushNotificationToken,
        sound: 'default',
        title: 'Workout Ready! 💪',
        body: `Your "${workoutName}" workout plan has been generated and is ready to use!`,
        data: {
          type: 'workout_completed',
          workoutId,
          workoutName,
          userId,
        },
        categoryId: 'workout_completion',
        priority: 'high',
      };

      await this.sendPushNotification([message]);
      
      logger.info('Workout completion notification sent', {
        operation: 'sendWorkoutCompletionNotification',
        userId,
        workoutId,
        workoutName,
      });

      return true;
    } catch (error) {
      logger.error('Failed to send workout completion notification', error as Error, {
        operation: 'sendWorkoutCompletionNotification',
        userId,
        workoutId,
      });
      return false;
    }
  }

  async sendWorkoutRegenerationNotification(
    userId: number,
    workoutName: string,
    workoutId: number
  ): Promise<boolean> {
    try {
      const user = await userService.getUserById(userId);
      
      if (!user?.pushNotificationToken) {
        logger.info('No push token found for user, skipping regeneration notification', {
          operation: 'sendWorkoutRegenerationNotification',
          userId,
        });
        return false;
      }

      const message: ExpoPushMessage = {
        to: user.pushNotificationToken,
        sound: 'default',
        title: 'Workout Updated! 🔄',
        body: `Your "${workoutName}" workout has been regenerated and is ready!`,
        data: {
          type: 'workout_regenerated',
          workoutId,
          workoutName,
          userId,
        },
        categoryId: 'workout_completion',
        priority: 'high',
      };

      await this.sendPushNotification([message]);
      
      logger.info('Workout regeneration notification sent', {
        operation: 'sendWorkoutRegenerationNotification',
        userId,
        workoutId,
        workoutName,
      });

      return true;
    } catch (error) {
      logger.error('Failed to send workout regeneration notification', error as Error, {
        operation: 'sendWorkoutRegenerationNotification',
        userId,
        workoutId,
      });
      return false;
    }
  }

  async sendDailyRegenerationNotification(
    userId: number,
    planDayName: string,
    planDayId: number
  ): Promise<boolean> {
    try {
      const user = await userService.getUserById(userId);
      
      if (!user?.pushNotificationToken) {
        logger.info('No push token found for user, skipping daily regeneration notification', {
          operation: 'sendDailyRegenerationNotification',
          userId,
        });
        return false;
      }

      const message: ExpoPushMessage = {
        to: user.pushNotificationToken,
        sound: 'default',
        title: 'Day Updated! ⚡',
        body: `Your "${planDayName}" workout has been regenerated!`,
        data: {
          type: 'daily_regenerated',
          planDayId,
          planDayName,
          userId,
        },
        categoryId: 'workout_completion',
        priority: 'normal',
      };

      await this.sendPushNotification([message]);
      
      logger.info('Daily regeneration notification sent', {
        operation: 'sendDailyRegenerationNotification',
        userId,
        planDayId,
        planDayName,
      });

      return true;
    } catch (error) {
      logger.error('Failed to send daily regeneration notification', error as Error, {
        operation: 'sendDailyRegenerationNotification',
        userId,
        planDayId,
      });
      return false;
    }
  }

  async sendWorkoutErrorNotification(
    userId: number,
    errorMessage: string
  ): Promise<boolean> {
    try {
      const user = await userService.getUserById(userId);
      
      if (!user?.pushNotificationToken) {
        logger.info('No push token found for user, skipping error notification', {
          operation: 'sendWorkoutErrorNotification',
          userId,
        });
        return false;
      }

      const message: ExpoPushMessage = {
        to: user.pushNotificationToken,
        sound: 'default',
        title: 'Workout Generation Failed',
        body: 'There was an issue generating your workout. Please try again or contact support.',
        data: {
          type: 'workout_error',
          errorMessage,
          userId,
        },
        categoryId: 'workout_error',
        priority: 'normal',
      };

      await this.sendPushNotification([message]);
      
      logger.info('Workout error notification sent', {
        operation: 'sendWorkoutErrorNotification',
        userId,
        errorMessage,
      });

      return true;
    } catch (error) {
      logger.error('Failed to send workout error notification', error as Error, {
        operation: 'sendWorkoutErrorNotification',
        userId,
      });
      return false;
    }
  }

  async sendDailyWorkoutReminderNotification(
    userId: number,
    workoutName: string
  ): Promise<boolean> {
    try {
      const user = await userService.getUserById(userId);
      
      if (!user?.pushNotificationToken) {
        return false;
      }

      const message: ExpoPushMessage = {
        to: user.pushNotificationToken,
        sound: 'default',
        title: 'Time to Work Out! 🏃‍♀️',
        body: `Don't forget about your "${workoutName}" workout today!`,
        data: {
          type: 'workout_reminder',
          workoutName,
          userId,
        },
        categoryId: 'workout_reminder',
        priority: 'normal',
      };

      await this.sendPushNotification([message]);
      return true;
    } catch (error) {
      logger.error('Failed to send workout reminder notification', error as Error, {
        operation: 'sendDailyWorkoutReminderNotification',
        userId,
      });
      return false;
    }
  }

  private async sendPushNotification(messages: ExpoPushMessage[]): Promise<void> {
    try {
      // Filter out invalid tokens
      const validMessages = messages.filter(message => 
        Expo.isExpoPushToken(message.to as string)
      );

      if (validMessages.length === 0) {
        logger.warn('No valid push tokens found in messages', {
          operation: 'sendPushNotification',
          totalMessages: messages.length,
        });
        return;
      }

      // Send notifications in chunks (Expo recommends chunks of 100)
      const chunks = this.expo.chunkPushNotifications(validMessages);
      const tickets: ExpoPushTicket[] = [];

      for (const chunk of chunks) {
        try {
          const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
          tickets.push(...ticketChunk);
        } catch (error) {
          logger.error('Error sending push notification chunk', error as Error, {
            operation: 'sendPushNotification',
            chunkSize: chunk.length,
          });
        }
      }

      // Check for tickets with errors
      const errorTickets = tickets.filter(ticket => ticket.status === 'error');
      if (errorTickets.length > 0) {
        logger.warn('Some push notifications had errors', {
          operation: 'sendPushNotification',
          errorCount: errorTickets.length,
          totalTickets: tickets.length,
          errors: errorTickets.map(ticket => ticket.message),
        });
      }

      logger.info('Push notifications sent successfully', {
        operation: 'sendPushNotification',
        totalMessages: validMessages.length,
        totalTickets: tickets.length,
        errorTickets: errorTickets.length,
      });

    } catch (error) {
      logger.error('Failed to send push notifications', error as Error, {
        operation: 'sendPushNotification',
        messageCount: messages.length,
      });
      throw error;
    }
  }

  // Optional: Handle push notification receipts to detect invalid tokens
  async handlePushReceipts(receiptIds: ExpoPushReceiptId[]): Promise<void> {
    try {
      const receiptIdChunks = this.expo.chunkPushNotificationReceiptIds(receiptIds);
      
      for (const chunk of receiptIdChunks) {
        const receipts = await this.expo.getPushNotificationReceiptsAsync(chunk);
        
        for (const receiptId in receipts) {
          const receipt = receipts[receiptId];
          
          if (receipt.status === 'error') {
            logger.warn('Push notification receipt error', {
              operation: 'handlePushReceipts',
              receiptId,
              message: receipt.message,
              details: receipt.details,
            });
            
            // Handle specific errors like invalid tokens
            if (receipt.details?.error === 'DeviceNotRegistered') {
              // TODO: Remove invalid token from user record
              logger.info('Device not registered, should remove token', {
                operation: 'handlePushReceipts',
                receiptId,
              });
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error handling push receipts', error as Error, {
        operation: 'handlePushReceipts',
      });
    }
  }
}

export const notificationService = new NotificationService();