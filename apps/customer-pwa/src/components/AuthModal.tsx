import { useState } from 'react';
import { useSendCode, useVerifyOtp } from '@cart-cloud/hooks';

interface AuthModalProps {
  onSuccess: () => void;
  onClose: () => void;
}

export function AuthModal({ onSuccess, onClose }: AuthModalProps) {
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSessionId, setOtpSessionId] = useState('');
  const [error, setError] = useState('');

  const sendCode = useSendCode();
  const verifyOtp = useVerifyOtp();

  const handleSendCode = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!phoneNumber || phoneNumber.length < 11) {
      setError('Please enter a valid phone number');
      return;
    }

    sendCode.mutate(
      {
        phone_number: phoneNumber,
        display_name: displayName,
        device_id: 'mock-device-id',
      },
      {
        onSuccess: (data) => {
          if (data.otp_required) {
            setOtpSessionId(data.otp_session_id);
            setStep('otp');
          } else {
            // Already registered, logged in
            onSuccess();
          }
        },
        onError: () => {
          setError('Failed to send verification code. Please try again.');
        },
      }
    );
  };

  const handleVerifyOtp = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!otpCode || otpCode.length < 4) {
      setError('Please enter a valid OTP code');
      return;
    }

    verifyOtp.mutate(
      {
        otp_session_id: otpSessionId,
        otp_code: otpCode,
      },
      {
        onSuccess: () => {
          onSuccess();
        },
        onError: () => {
          setError('Invalid OTP code. Please try again.');
        },
      }
    );
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">
            {step === 'phone' ? 'Login / Register' : 'Verify OTP'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        {step === 'phone' && (
          <form onSubmit={handleSendCode} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone Number
              </label>
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="01XXXXXXXXX"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Your Name (optional for new users)
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter your name"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
            </div>

            <button
              type="submit"
              disabled={sendCode.isPending}
              className="w-full py-3 bg-orange-500 text-white rounded-lg font-semibold hover:bg-orange-600 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {sendCode.isPending ? 'Sending...' : 'Send OTP'}
            </button>

            <p className="text-sm text-gray-500 text-center">
              We'll send a verification code to your phone
            </p>
          </form>
        )}

        {step === 'otp' && (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Enter OTP Code
              </label>
              <input
                type="text"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder="Enter 6-digit code"
                maxLength={6}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent text-center text-2xl tracking-widest"
                required
              />
            </div>

            <button
              type="submit"
              disabled={verifyOtp.isPending}
              className="w-full py-3 bg-orange-500 text-white rounded-lg font-semibold hover:bg-orange-600 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {verifyOtp.isPending ? 'Verifying...' : 'Verify & Login'}
            </button>

            <button
              type="button"
              onClick={() => setStep('phone')}
              className="w-full py-3 text-gray-600 hover:text-gray-800"
            >
              Change phone number
            </button>

            <p className="text-sm text-gray-500 text-center">
              Demo OTP: 123456
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
