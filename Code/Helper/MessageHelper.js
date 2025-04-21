import { showMessage } from 'react-native-flash-message';

// Store the last shown messages and their timestamps
const messageHistory = new Map();
const DEBOUNCE_TIME = 1200; // 1.5 seconds debounce time
let currentlyVisibleMessage = null;

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
  
  // Check if this exact message is currently visible
  if (currentlyVisibleMessage === messageKey) {
    return; // Skip if the same message is already visible
  }
  
  // Check if this message was shown recently
  const lastShown = messageHistory.get(messageKey);
  if (lastShown && (now - lastShown) < DEBOUNCE_TIME) {
    return; // Skip if shown within debounce time
  }
  
  // Update the message history
  messageHistory.set(messageKey, now);
  
  // Set the currently visible message
  currentlyVisibleMessage = messageKey;
  
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
    id: id || messageKey,
    onShow: () => {
      // Set a timeout to clear the currently visible message after the duration
      setTimeout(() => {
        if (currentlyVisibleMessage === messageKey) {
          currentlyVisibleMessage = null;
        }
      }, duration || 3000);
    }
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