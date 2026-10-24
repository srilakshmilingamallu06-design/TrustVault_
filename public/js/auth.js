/**
 * TrustVault Client Authentication & Shared Lifecycle Manager
 */
(function (window) {
  'use strict';

  window.TrustVault = window.TrustVault || {};

  window.TrustVault.onReady = function (fn) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(fn, 0);
    } else {
      document.addEventListener('DOMContentLoaded', fn);
    }
  };

  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
  }

  const auth = {
    state: 'loading', // 'loading' | 'authenticated' | 'unauthenticated' | 'error'
    user: null,
    csrfToken: null,
    hasChecked: false,

    /**
     * Check session once on page initialization
     * @param {object} options
     * @param {boolean} [options.requireAuth=false] - Whether page requires user to be logged in
     * @param {function} [options.onReady] - Callback when auth state resolved
     */
    async init(options = {}) {
      const { requireAuth = false, onReady = null } = options;

      if (this.hasChecked) {
        if (onReady) onReady(this.user, this.state);
        return;
      }

      this.hasChecked = true;
      this.state = 'loading';

      try {
        const response = await fetch('/api/auth/me', {
          method: 'GET',
          headers: {
            'Accept': 'application/json'
          }
        });

        if (response.status === 200) {
          const data = await response.json();
          this.state = 'authenticated';
          this.user = data.user;
          this.csrfToken = data.csrfToken || getCookie('XSRF-TOKEN');

          this.updateNavUi();

          // If on login/register page and already authenticated, navigate to dashboard
          const currentPath = window.location.pathname;
          if (
            currentPath.endsWith('login.html') || currentPath === '/login' ||
            currentPath.endsWith('register.html') || currentPath === '/register' || currentPath === '/signup'
          ) {
            window.location.href = '/dashboard.html';
            return;
          }

          if (onReady) onReady(this.user, this.state);
        } else if (response.status === 401) {
          this.state = 'unauthenticated';
          this.user = null;

          if (requireAuth) {
            window.location.href = '/login.html';
            return;
          }

          if (onReady) onReady(null, this.state);
        } else {
          this.state = 'error';
          if (requireAuth) {
            this.showToast('Unable to verify authentication. Please sign in.', 'error');
            setTimeout(() => window.location.replace('/login.html'), 1500);
          }
          if (onReady) onReady(null, this.state);
        }
      } catch (err) {
        console.error('[TrustVault Auth] Session verification failed due to network error:', err);
        this.state = 'error';
        if (requireAuth) {
          this.showToast('Network error while verifying session. Please check your connection.', 'error');
        }
        if (onReady) onReady(null, this.state);
      }
    },

    /**
     * Authenticate user with credentials
     */
    async login(email, password) {
      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok && data.success) {
          this.state = 'authenticated';
          this.user = data.user;
          this.csrfToken = data.csrfToken || getCookie('XSRF-TOKEN');
          window.location.href = '/dashboard.html';
          return { success: true };
        } else {
          return { success: false, error: data.error || 'Authentication failed. Please check your credentials.' };
        }
      } catch (err) {
        return { success: false, error: 'Network error. Could not connect to the server.' };
      }
    },

    /**
     * Register a new user and organization
     */
    async register({ name, email, password, organizationName }) {
      try {
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ name, email, password, organizationName })
        });

        const data = await response.json();

        if (response.ok && data.success) {
          this.state = 'authenticated';
          this.user = data.user;
          this.csrfToken = data.csrfToken || getCookie('XSRF-TOKEN');
          window.location.href = '/dashboard.html';
          return { success: true };
        } else {
          return { success: false, error: data.error || 'Registration failed.' };
        }
      } catch (err) {
        return { success: false, error: 'Network error. Could not reach server during registration.' };
      }
    },

    /**
     * Terminate active session
     */
    async logout() {
      try {
        await this.apiFetch('/api/auth/logout', { method: 'POST' });
      } catch {
        // Continue logout navigation even on network hiccup
      } finally {
        this.state = 'unauthenticated';
        this.user = null;
        window.location.href = '/login.html';
      }
    },

    /**
     * Wrapper for API requests with CSRF injection and clean 401 handling
     */
    async apiFetch(url, options = {}) {
      options.headers = options.headers || {};

      const token = this.csrfToken || getCookie('XSRF-TOKEN');
      if (token && ['POST', 'PUT', 'DELETE', 'PATCH'].includes((options.method || 'GET').toUpperCase())) {
        options.headers['x-csrf-token'] = token;
      }

      if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(options.body);
      }

      const response = await fetch(url, options);

      // Handle session expiration cleanly
      if (response.status === 401 && !url.includes('/api/auth/login')) {
        this.state = 'unauthenticated';
        this.user = null;
        this.showToast('Your session has expired. Redirecting to login...', 'error');
        setTimeout(() => window.location.replace('/login.html'), 1200);
        throw new Error('Unauthorized');
      }

      return response;
    },

    /**
     * Update navigation bar components with active user details
     */
    updateNavUi() {
      if (!this.user) return;

      const userNameEl = document.getElementById('nav-user-name');
      const orgNameEl = document.getElementById('nav-org-name');
      const roleBadgeEl = document.getElementById('nav-role-badge');
      const auditLink = document.getElementById('nav-audit-link');
      const membersLink = document.getElementById('nav-members-link');

      if (userNameEl) userNameEl.textContent = this.user.name;
      if (orgNameEl) orgNameEl.textContent = this.user.organizationName;

      if (roleBadgeEl) {
        roleBadgeEl.textContent = this.user.role.toUpperCase();
        roleBadgeEl.className = `role-badge role-${this.user.role}`;
      }

      // Hide or show audit link based on role
      if (auditLink) {
        if (this.user.role === 'admin') {
          auditLink.style.display = 'inline-flex';
        } else {
          auditLink.style.display = 'none';
        }
      }

      // Hide or show members link based on role
      if (membersLink) {
        if (this.user.role === 'admin') {
          membersLink.style.display = 'inline-flex';
        } else {
          membersLink.style.display = 'none';
        }
      }

      const logoutBtn = document.getElementById('btn-logout');
      if (logoutBtn) {
        logoutBtn.onclick = (e) => {
          e.preventDefault();
          this.logout();
        };
      }
    },

    /**
     * Show temporary toast notification
     */
    showToast(message, type = 'info', duration = 4000) {
      let container = document.getElementById('toast-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
      }

      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.textContent = message;

      container.appendChild(toast);

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }
  };

  window.TrustVault.auth = auth;
})(window);
