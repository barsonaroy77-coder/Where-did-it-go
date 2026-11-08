import {
  validateEmail,
  validatePassword,
  isNetworkOrOfflineError,
  getSafeAuthErrorMessage,
} from '../auth';

jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      resetPasswordForEmail: jest.fn(),
      getSession: jest.fn(),
      getUser: jest.fn(),
    },
  },
  isSupabaseConfigured: true,
}));

describe('Auth Helpers', () => {
  describe('validateEmail', () => {
    it('returns an error when email is empty or whitespace', () => {
      expect(validateEmail('')).toBe('Email address is required.');
      expect(validateEmail('   ')).toBe('Email address is required.');
    });

    it('returns an error for malformed email addresses', () => {
      expect(validateEmail('notanemail')).toBe('Please enter a valid email address.');
      expect(validateEmail('user@')).toBe('Please enter a valid email address.');
      expect(validateEmail('@domain.com')).toBe('Please enter a valid email address.');
      expect(validateEmail('user@domain')).toBe('Please enter a valid email address.');
      expect(validateEmail('user with spaces@domain.com')).toBe(
        'Please enter a valid email address.'
      );
    });

    it('returns null for valid email addresses and ignores outer whitespace', () => {
      expect(validateEmail('user@example.com')).toBeNull();
      expect(validateEmail('  user@example.com  ')).toBeNull();
      expect(validateEmail('first.last+tag@sub.domain.co.uk')).toBeNull();
    });
  });

  describe('validatePassword', () => {
    it('returns an error when password is empty', () => {
      expect(validatePassword('')).toBe('Password is required.');
    });

    it('returns an error when password is shorter than 6 characters', () => {
      expect(validatePassword('12345')).toBe('Password must be at least 6 characters.');
      expect(validatePassword('abc')).toBe('Password must be at least 6 characters.');
    });

    it('returns null when password is 6 characters or longer', () => {
      expect(validatePassword('123456')).toBeNull();
      expect(validatePassword('supersecretpassword')).toBeNull();
    });
  });

  describe('isNetworkOrOfflineError', () => {
    it('identifies network and fetch error messages', () => {
      expect(isNetworkOrOfflineError('Failed to fetch')).toBe(true);
      expect(isNetworkOrOfflineError('Network request failed')).toBe(true);
      expect(isNetworkOrOfflineError('Connection refused')).toBe(true);
      expect(isNetworkOrOfflineError('Request timed out after 10000ms')).toBe(true);
      expect(isNetworkOrOfflineError('Device is currently offline')).toBe(true);
    });

    it('identifies structured error objects with network properties or status codes', () => {
      expect(isNetworkOrOfflineError({ message: 'fetch failed' })).toBe(true);
      expect(isNetworkOrOfflineError({ name: 'AuthRetryableFetchError' })).toBe(true);
      expect(isNetworkOrOfflineError({ code: 'offline' })).toBe(true);
      expect(isNetworkOrOfflineError({ status: 0 })).toBe(true);
      expect(isNetworkOrOfflineError({ status: 503 })).toBe(true);
    });

    it('returns false for standard authentication credential errors', () => {
      expect(isNetworkOrOfflineError('Invalid login credentials')).toBe(false);
      expect(isNetworkOrOfflineError({ message: 'User already registered' })).toBe(false);
      expect(isNetworkOrOfflineError({ message: 'Password is too weak' })).toBe(false);
      expect(isNetworkOrOfflineError(null)).toBe(false);
    });
  });

  describe('getSafeAuthErrorMessage', () => {
    describe('sign-in mode', () => {
      it('always returns the exact generic message for any failed sign-in credential error', () => {
        const expected = 'Wrong email or password. Please try again.';

        expect(getSafeAuthErrorMessage('sign-in', 'Invalid login credentials')).toBe(expected);
        expect(getSafeAuthErrorMessage('sign-in', { message: 'Invalid password' })).toBe(expected);
        expect(getSafeAuthErrorMessage('sign-in', { message: 'User not found' })).toBe(expected);
        expect(
          getSafeAuthErrorMessage('sign-in', { message: 'Email does not exist' })
        ).toBe(expected);
        expect(
          getSafeAuthErrorMessage('sign-in', { message: 'invalid_grant', code: '400' })
        ).toBe(expected);
      });

      it('does not leak whether email or password was the incorrect part', () => {
        const msg = getSafeAuthErrorMessage('sign-in', { message: 'password incorrect' });
        expect(msg).toBe('Wrong email or password. Please try again.');
        expect(msg.toLowerCase()).not.toContain('password incorrect');
      });

      it('returns a connection error message when the failure is network-related', () => {
        expect(getSafeAuthErrorMessage('sign-in', 'Failed to fetch')).toBe(
          'Unable to connect to the authentication server. Please check your internet connection.'
        );
        expect(
          getSafeAuthErrorMessage('sign-in', { message: 'Network request failed' })
        ).toBe(
          'Unable to connect to the authentication server. Please check your internet connection.'
        );
      });
    });

    describe('sign-up mode', () => {
      it('returns safe message for weak or short passwords', () => {
        expect(
          getSafeAuthErrorMessage('sign-up', {
            message: 'Password should be at least 6 characters',
          })
        ).toBe('Password must be at least 6 characters.');
        expect(
          getSafeAuthErrorMessage('sign-up', { message: 'Password is too short' })
        ).toBe('Password must be at least 6 characters.');
      });

      it('returns safe message when user is already registered', () => {
        expect(
          getSafeAuthErrorMessage('sign-up', { message: 'User already registered' })
        ).toBe('An account with this email already exists.');
        expect(
          getSafeAuthErrorMessage('sign-up', { message: 'user_already_exists' })
        ).toBe('An account with this email already exists.');
      });

      it('returns safe message for invalid email format', () => {
        expect(
          getSafeAuthErrorMessage('sign-up', { message: 'Invalid email address provided' })
        ).toBe('Please enter a valid email address.');
      });

      it('returns network error message on network failure', () => {
        expect(getSafeAuthErrorMessage('sign-up', 'Connection refused')).toBe(
          'Unable to connect to the authentication server. Please check your internet connection.'
        );
      });

      it('falls back to safe generic registration failure message for unknown errors', () => {
        expect(
          getSafeAuthErrorMessage('sign-up', { message: 'Internal server exception 99' })
        ).toBe('Unable to create account. Please check your details and try again.');
      });
    });

    describe('forgot-password mode', () => {
      it('returns safe message for invalid email', () => {
        expect(
          getSafeAuthErrorMessage('forgot-password', { message: 'Invalid email' })
        ).toBe('Please enter a valid email address.');
      });

      it('returns network error message on network failure', () => {
        expect(getSafeAuthErrorMessage('forgot-password', 'fetch failed')).toBe(
          'Unable to connect to the authentication server. Please check your internet connection.'
        );
      });

      it('returns safe fallback message for unknown errors', () => {
        expect(
          getSafeAuthErrorMessage('forgot-password', { message: 'Rate limit exceeded' })
        ).toBe('Unable to send reset instructions. Please try again.');
      });
    });
  });
});
