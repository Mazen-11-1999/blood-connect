// API Client for Blood Connect Backend
class ApiClient {
    constructor() {
        this.baseURL = window.location.origin + '/api';
        this.token = localStorage.getItem('bloodConnect_token');
    }

    // Helper method for API calls
    async apiCall(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        // Add authorization token if available
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        try {
            const response = await fetch(url, {
                ...options,
                headers
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'API request failed');
            }

            return data;
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    }

    // Authentication methods
    async register(userData) {
        const result = await this.apiCall('/auth/register', {
            method: 'POST',
            body: JSON.stringify(userData)
        });
        
        if (result.token) {
            this.token = result.token;
            localStorage.setItem('bloodConnect_token', result.token);
            localStorage.setItem('bloodConnect_user', JSON.stringify(result.user));
        }
        
        return result;
    }

    async login(email, password) {
        const result = await this.apiCall('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
        
        if (result.token) {
            this.token = result.token;
            localStorage.setItem('bloodConnect_token', result.token);
            localStorage.setItem('bloodConnect_user', JSON.stringify(result.user));
        }
        
        return result;
    }

    async getProfile() {
        return await this.apiCall('/auth/profile');
    }

    async updateProfile(userData) {
        return await this.apiCall('/auth/profile', {
            method: 'PUT',
            body: JSON.stringify(userData)
        });
    }

    logout() {
        this.token = null;
        localStorage.removeItem('bloodConnect_token');
        localStorage.removeItem('bloodConnect_user');
    }

    // Donor methods
    async getDonors(filters = {}) {
        const params = new URLSearchParams(filters);
        return await this.apiCall(`/donors?${params}`);
    }

    async getDonor(id) {
        return await this.apiCall(`/donors/${id}`);
    }

    async addDonor(donorData) {
        return await this.apiCall('/donors', {
            method: 'POST',
            body: JSON.stringify(donorData)
        });
    }

    async updateDonorAvailability(id, isAvailable) {
        return await this.apiCall(`/donors/${id}/availability`, {
            method: 'PATCH',
            body: JSON.stringify({ isAvailable })
        });
    }

    async getDonorStats() {
        return await this.apiCall('/donors/stats/summary');
    }

    // Message methods
    async getMessages(userId, filters = {}) {
        const params = new URLSearchParams({ userId, ...filters });
        return await this.apiCall(`/messages?${params}`);
    }

    async getMessage(id) {
        return await this.apiCall(`/messages/${id}`);
    }

    async sendMessage(messageData) {
        return await this.apiCall('/messages', {
            method: 'POST',
            body: JSON.stringify(messageData)
        });
    }

    async markMessageAsRead(id) {
        return await this.apiCall(`/messages/${id}/read`, {
            method: 'PATCH'
        });
    }

    async markMultipleAsRead(messageIds) {
        return await this.apiCall('/messages/mark-read/bulk', {
            method: 'PATCH',
            body: JSON.stringify({ messageIds })
        });
    }

    async deleteMessage(id) {
        return await this.apiCall(`/messages/${id}`, {
            method: 'DELETE'
        });
    }

    async getConversation(userId1, userId2) {
        return await this.apiCall(`/messages/conversation/${userId1}/${userId2}`);
    }

    async getMessageStats(userId) {
        return await this.apiCall(`/messages/stats/${userId}`);
    }

    // SMS methods
    async sendSMS(to, message) {
        return await this.apiCall('/sms/send', {
            method: 'POST',
            body: JSON.stringify({ to, message })
        });
    }

    async sendUrgentSMS(to, recipientName, bloodType, urgency, location) {
        return await this.apiCall('/sms/urgent', {
            method: 'POST',
            body: JSON.stringify({ to, recipientName, bloodType, urgency, location })
        });
    }

    async getSMSStatus(sid) {
        return await this.apiCall(`/sms/status/${sid}`);
    }

    // Health check
    async healthCheck() {
        return await this.apiCall('/health');
    }

    // Get current user from localStorage
    getCurrentUser() {
        const userStr = localStorage.getItem('bloodConnect_user');
        return userStr ? JSON.parse(userStr) : null;
    }

    // Check if user is authenticated
    isAuthenticated() {
        return !!this.token && !!this.getCurrentUser();
    }
}

// SMS Service using Backend API (replaces direct Twilio calls)
class SMSService {
    constructor() {
        this.api = new ApiClient();
    }

    async sendSMS(toPhone, message) {
        try {
            const result = await this.api.sendSMS(toPhone, message);
            console.log('✅ SMS sent via backend:', result);
            return result;
        } catch (error) {
            console.error('❌ SMS sending failed:', error);
            throw error;
        }
    }

    async sendUrgentSMS(toPhone, options) {
        try {
            const { recipientName, bloodType, urgency, location } = options;
            const result = await this.api.sendUrgentSMS(
                toPhone, 
                recipientName, 
                bloodType, 
                urgency, 
                location
            );
            console.log('🚨 Urgent SMS sent via backend:', result);
            return result;
        } catch (error) {
            console.error('❌ Urgent SMS sending failed:', error);
            throw error;
        }
    }
}

// Notification Service (for browser notifications)
class NotificationService {
    constructor() {
        this.permission = 'default';
        this.checkPermission();
    }

    async checkPermission() {
        if ('Notification' in window) {
            this.permission = Notification.permission;
        }
    }

    async requestPermission() {
        if ('Notification' in window) {
            this.permission = await Notification.requestPermission();
            return this.permission;
        }
        return 'denied';
    }

    showNotification(title, options = {}) {
        if (this.permission === 'granted') {
            return new Notification(title, {
                icon: '/icon-192x192.png',
                badge: '/icon-192x192.png',
                ...options
            });
        }
        return null;
    }

    async showNewMessageNotification(message) {
        const title = 'رسالة جديدة في منصة إنقاذ حياة';
        const options = {
            body: `${message.senderName}: ${message.content.substring(0, 100)}...`,
            tag: `message-${message.id}`,
            renotify: true,
            requireInteraction: true
        };

        const notification = this.showNotification(title, options);
        
        if (notification) {
            notification.onclick = () => {
                window.focus();
                // Navigate to messages page
                if (typeof showSection === 'function') {
                    showSection('messages');
                }
            };
        }

        return notification;
    }

    async showUrgentRequestNotification(request) {
        const title = '🚨 طلب دم عاجل';
        const options = {
            body: `فصيلة ${request.bloodType} مطلوبة في ${request.location}`,
            tag: `urgent-${request.id}`,
            renotify: true,
            requireInteraction: true
        };

        return this.showNotification(title, options);
    }
}

// Enhanced Data Manager using Backend API
class EnhancedDataManager {
    constructor() {
        this.api = new ApiClient();
        this.sms = new SMSService();
        this.notifications = new NotificationService();
        
        // Initialize with localStorage fallback for offline mode
        this.initStorage();
    }

    initStorage() {
        // Keep localStorage for offline functionality
        if (!localStorage.getItem('bloodConnect_donors')) {
            localStorage.setItem('bloodConnect_donors', JSON.stringify([]));
        }
        if (!localStorage.getItem('bloodConnect_messages')) {
            localStorage.setItem('bloodConnect_messages', JSON.stringify([]));
        }
    }

    // Authentication methods
    async login(email, password) {
        try {
            return await this.api.login(email, password);
        } catch (error) {
            console.error('Login failed:', error);
            throw error;
        }
    }

    async register(userData) {
        try {
            return await this.api.register(userData);
        } catch (error) {
            console.error('Registration failed:', error);
            throw error;
        }
    }

    logout() {
        this.api.logout();
    }

    getCurrentUser() {
        return this.api.getCurrentUser();
    }

    isAuthenticated() {
        return this.api.isAuthenticated();
    }

    // Donor methods (using API)
    async getDonors(filters = {}) {
        try {
            const result = await this.api.getDonors(filters);
            return result.donors || [];
        } catch (error) {
            console.error('Failed to get donors from API, using localStorage:', error);
            // Fallback to localStorage
            return JSON.parse(localStorage.getItem('bloodConnect_donors') || '[]');
        }
    }

    async addDonor(donor) {
        try {
            const result = await this.api.addDonor(donor);
            return result.donor;
        } catch (error) {
            console.error('Failed to add donor via API, using localStorage:', error);
            // Fallback to localStorage
            const donors = JSON.parse(localStorage.getItem('bloodConnect_donors') || '[]');
            const newDonor = {
                id: Date.now().toString(),
                ...donor,
                createdAt: new Date().toISOString()
            };
            donors.push(newDonor);
            localStorage.setItem('bloodConnect_donors', JSON.stringify(donors));
            return newDonor;
        }
    }

    async updateDonor(id, updates) {
        try {
            if (updates.isAvailable !== undefined) {
                return await this.api.updateDonorAvailability(id, updates.isAvailable);
            }
            // For other updates, we'd need a full update endpoint
            throw new Error('Full donor update not implemented in API yet');
        } catch (error) {
            console.error('Failed to update donor via API, using localStorage:', error);
            // Fallback to localStorage
            const donors = JSON.parse(localStorage.getItem('bloodConnect_donors') || '[]');
            const index = donors.findIndex(d => d.id === id);
            if (index !== -1) {
                donors[index] = { ...donors[index], ...updates };
                localStorage.setItem('bloodConnect_donors', JSON.stringify(donors));
                return donors[index];
            }
            return null;
        }
    }

    getDonorById(id) {
        // Try API first, then fallback
        const donors = JSON.parse(localStorage.getItem('bloodConnect_donors') || '[]');
        return donors.find(d => d.id === id);
    }

    // Message methods (using API)
    async getMessagesForUser(userId, filters = {}) {
        try {
            const result = await this.api.getMessages(userId, filters);
            return result.messages || [];
        } catch (error) {
            console.error('Failed to get messages from API, using localStorage:', error);
            // Fallback to localStorage
            const messages = JSON.parse(localStorage.getItem('bloodConnect_messages') || '[]');
            return messages.filter(m => m.recipientId === userId || m.senderId === userId);
        }
    }

    async addMessage(message) {
        try {
            const result = await this.api.sendMessage(message);
            
            // Show notification for new message
            if (this.notifications.permission === 'granted') {
                await this.notifications.showNewMessageNotification(result.data);
            }
            
            return result.data;
        } catch (error) {
            console.error('Failed to send message via API, using localStorage:', error);
            // Fallback to localStorage
            const messages = JSON.parse(localStorage.getItem('bloodConnect_messages') || '[]');
            const newMessage = {
                id: Date.now().toString(),
                ...message,
                createdAt: new Date().toISOString(),
                read: false
            };
            messages.push(newMessage);
            localStorage.setItem('bloodConnect_messages', JSON.stringify(messages));
            return newMessage;
        }
    }

    async markMessageAsRead(messageId) {
        try {
            return await this.api.markMessageAsRead(messageId);
        } catch (error) {
            console.error('Failed to mark message as read via API, using localStorage:', error);
            // Fallback to localStorage
            const messages = JSON.parse(localStorage.getItem('bloodConnect_messages') || '[]');
            const message = messages.find(m => m.id === messageId);
            if (message) {
                message.read = true;
                localStorage.setItem('bloodConnect_messages', JSON.stringify(messages));
            }
        }
    }

    deleteMessagesForUser(userId) {
        // Fallback to localStorage
        const messages = JSON.parse(localStorage.getItem('bloodConnect_messages') || '[]');
        const filteredMessages = messages.filter(m => 
            m.senderId !== userId && m.recipientId !== userId
        );
        localStorage.setItem('bloodConnect_messages', JSON.stringify(filteredMessages));
        return messages.length - filteredMessages.length;
    }

    // SMS methods (using backend API)
    async sendUrgentNotification(recipient, message, urgency = 'normal') {
        try {
            if (recipient.phone) {
                const internationalPhone = this.formatPhoneNumber(recipient.phone);
                
                if (urgency === 'urgent') {
                    await this.sms.sendUrgentSMS(internationalPhone, {
                        recipientName: recipient.fullName,
                        bloodType: recipient.bloodType,
                        urgency: urgency,
                        location: `${recipient.city} - ${recipient.region}`
                    });
                } else {
                    await this.sms.sendSMS(internationalPhone, message);
                }
                
                return true;
            }
            return false;
        } catch (error) {
            console.error('SMS sending failed:', error);
            return false;
        }
    }

    formatPhoneNumber(phone) {
        // Format phone number for international use
        if (!phone) return '';
        
        // Remove any non-digit characters
        let cleanPhone = phone.replace(/\D/g, '');
        
        // Add country code if not present (assuming Saudi Arabia)
        if (!cleanPhone.startsWith('966') && !cleanPhone.startsWith('+')) {
            cleanPhone = '966' + cleanPhone;
        }
        
        // Add + if not present
        if (!cleanPhone.startsWith('+')) {
            cleanPhone = '+' + cleanPhone;
        }
        
        return cleanPhone;
    }

    // Utility methods
    updateMessageCount() {
        // This would be handled by the API now
        const messages = JSON.parse(localStorage.getItem('bloodConnect_messages') || '[]');
        const user = this.getCurrentUser();
        if (user) {
            const unreadCount = messages.filter(m => 
                m.recipientId === user.id && !m.read
            ).length;
            
            // Update UI if needed
            const messageBadge = document.querySelector('.message-badge');
            if (messageBadge) {
                messageBadge.textContent = unreadCount;
                messageBadge.style.display = unreadCount > 0 ? 'block' : 'none';
            }
        }
    }

    async checkHealth() {
        try {
            return await this.api.healthCheck();
        } catch (error) {
            console.error('Health check failed:', error);
            return null;
        }
    }
}

// Initialize the enhanced data manager
const dataManager = new EnhancedDataManager();

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ApiClient, SMSService, NotificationService, EnhancedDataManager, dataManager };
}
