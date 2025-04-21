import { showMessage } from 'react-native-flash-message';

// Store the last shown message and its timestamp
let lastMessage = {
  message: null,
  description: null,
  type: null,
  timestamp: 0
};

// Debounce time in milliseconds (adjust as needed)
const DEBOUNCE_TIME = 1000;

/**
 * Debounced version of showMessage that prevents duplicate messages
 * from appearing in quick succession
 * 
 * @param {Object} options - The message options
 * @param {string} options.message - The message title
 * @param {string} [options.description] - The message description
 * @param {string} [options.type] - The message type (success, danger, warning, info)
 * @param {number} [options.duration] - How long to show the message (in ms)
 * @param {string} [options.id] - Unique identifier for the message
 */
export const showDebouncedMessage = (options) => {
  const now = Date.now();
  const { message, description, type, duration, id } = options;
  
  // Check if this is a duplicate of the last message and within debounce time
  const isDuplicate = 
    lastMessage.message === message && 
    lastMessage.description === description && 
    lastMessage.type === type && 
    (now - lastMessage.timestamp) < DEBOUNCE_TIME;
  
  // If it's a duplicate and within debounce time, don't show it
  if (isDuplicate) {
    return;
  }
  
  // Update the last message
  lastMessage = {
    message,
    description,
    type,
    timestamp: now
  };
  
  // Show the message
  showMessage({
    message,
    description,
    type,
    duration,
    id
  });
}; 