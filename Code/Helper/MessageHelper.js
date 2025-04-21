import { showMessage } from 'react-native-flash-message';

// Store the last shown messages and their timestamps
const messageHistory = new Map();
const DEBOUNCE_TIME = 1000; // 1 second debounce time

/**
 * Enhanced version of showMessage that prevents duplicate messages
 * and manages message history
 * 
 * @param {Object} options - The message options
 * @param {string} options.message - The message title
 * @param {string} [options.description] - The message description
 * @param {string} [options.type] - The message type (success, danger, warning, info)
 * @param {number} [options.duration] - How long to show the message (in ms)
 * @param {string} [options.id] - Unique identifier for the message
 */
export const showUniqueMessage = (options) => {
  const now = Date.now();
  const { message, description, type, duration, id } = options;
  
  // Create a unique key for the message
  const messageKey = `${message}-${description}-${type}`;
  
  // Check if this message was shown recently
  const lastShown = messageHistory.get(messageKey);
  if (lastShown && (now - lastShown) < DEBOUNCE_TIME) {
    return; // Skip if shown within debounce time
  }
  
  // Update the message history
  messageHistory.set(messageKey, now);
  
  // Clean up old messages from history (older than 5 seconds)
  for (const [key, timestamp] of messageHistory.entries()) {
    if (now - timestamp > 5000) {
      messageHistory.delete(key);
    }
  }
  
  // Show the message
  showMessage({
    message,
    description,
    type,
    duration: duration || 3000,
    id: id || messageKey
  });
};

// Convenience methods for common message types
export const showSuccessMessage = (message, description) => {
  showUniqueMessage({ message, description, type: 'success' });
};

export const showErrorMessage = (message, description) => {
  showUniqueMessage({ message, description, type: 'danger' });
};

export const showWarningMessage = (message, description) => {
  showUniqueMessage({ message, description, type: 'warning' });
};

export const showInfoMessage = (message, description) => {
  showUniqueMessage({ message, description, type: 'info' });
}; 