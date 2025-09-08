
// import React, { useState } from 'react'; 
// import { 
//   View, 
//   Text, 
//   StyleSheet, 
//   TextInput, 
//   TouchableOpacity, 
//   Dimensions,
//   KeyboardAvoidingView,
//   Platform,
//   ScrollView,
//   Image,
//   ActivityIndicator,      
// } from 'react-native';
// import globalStyles from './globalStyles';

// const { width, height } = Dimensions.get('window');

// export default function Login({ navigation }) {
//   const [email, setEmail] = useState('');
//   const [password, setPassword] = useState('');
//   const [error, setError] = useState('');
//     const [isLoading, setIsLoading] = useState(false);

//   const handleLogin = () => {
//     if (!email || !password) {
//       setError('Please fill all fields');
//       return;
//     }

//     if (email === 'admin' && password === 'admin') {
//       setError('');
//       navigation.navigate('Home'); // Navigate to Home screen
//     } else {
//       setError('Invalid Username or Password');
//     }
//   };


//   return (
//     <KeyboardAvoidingView
//       behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
//       style={styles.container}
//     >
//       <ScrollView contentContainerStyle={styles.scrollContent}>
//         <View style={styles.mainContent}>
//           {/* Logo */}
//           <Image
//             source={require('./assets/infuzamed_logo.png')}
//             style={styles.logo}
//             resizeMode="contain"
//           />
          
//           {/* Form Container */}
//           <View style={styles.formContainer}>
//             {/* Email Field */}
//             <View style={styles.inputGroup}>
//               <Text style={styles.label}>Email</Text>
//               <TextInput
//                 style={styles.input}
//                 value={email}
//                 onChangeText={(text) => {
//                   setEmail(text);
//                   setError('');
//                 }}
//                 placeholder="Enter your email"
//                 placeholderTextColor="#999"
//                 keyboardType="email-address"
//                 autoCapitalize="none"
//                 autoCorrect={false}
//               />
//             </View>
            
//             {/* Password Field */}
//             <View style={styles.inputGroup}>
//               <Text style={styles.label}>Password</Text>
//               <TextInput
//                 style={styles.input}
//                 value={password}
//                 onChangeText={(text) => {
//                   setPassword(text);
//                   setError('');
//                 }}
//                 placeholder="Enter your password"
//                 placeholderTextColor="#999"
//                 secureTextEntry
//                 autoCapitalize="none"
//                 autoCorrect={false}
//               />
//             </View>

//             {/* Error Message */}
//             {error ? <Text style={styles.errorText}>{error}</Text> : null}
            
//             {/* Login Button */}
//             <TouchableOpacity 
//               style={[styles.button, isLoading && styles.buttonDisabled]} 
//               onPress={handleLogin}
//               activeOpacity={0.8}
//               disabled={isLoading}
//             >
//               {isLoading ? (
//                 <ActivityIndicator color="#fff" />
//               ) : (
//                 <Text style={styles.buttonText}>Login</Text>
//               )}
//             </TouchableOpacity>

//             {/* Forgot Password Link */}
//             {/* <TouchableOpacity 
//               style={styles.forgotPasswordContainer}
//               onPress={() => Alert.alert('Forgot Password', 'Please contact support to reset your password.')}
//             >
//               <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
//             </TouchableOpacity> */}
//           </View>
//         </View>

//         {/* Footer - Fixed at bottom */}
//         <View style={styles.footer}>
//           <Text style={styles.footerText}>Developed By</Text>
//           <Text style={[styles.footerText, styles.footerCompany]}>Revive Medical Technologies Inc.</Text>
//         </View>
//       </ScrollView>
//     </KeyboardAvoidingView>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: '#ffffff',
//   },
//   scrollContent: {
//     flexGrow: 1,
//     justifyContent: 'space-between',
//   },
//   mainContent: {
//     flex: 1,
//     justifyContent: 'center',
//     paddingHorizontal: width * 0.1,
//   },
//   logo: {
//     width: width * 0.9,
//     height: height * 0.2,
//     alignSelf: 'center',
//     marginBottom: height * 0.09,
//   },
//   formContainer: {
//     width: '100%',
//   },
//   inputGroup: {
//     marginBottom: height * 0.02,
//   },
//   label: {
//     fontSize: width * 0.045,
//     fontWeight: 'bold',
//     color: '#2f2f2f',
//     marginBottom: height * 0.01,
//   },
//   input: {
//     width: '100%',
//     fontSize: width * 0.04,
//     padding: width * 0.04,
//     borderRadius: 12,
//     backgroundColor: '#ebf2f9',
//     color: '#333',
//     borderWidth: 1,
//     borderColor: '#ddd',
//   },
//   errorText: {
//     color: '#e74c3c',
//     fontSize: width * 0.035,
//     marginTop: height * 0.01,
//     textAlign: 'center',
//     fontWeight: '500',
//   },
// button: {
//   backgroundColor: globalStyles.primaryColor.color,
//   paddingVertical: height * 0.02,
//   width: '60%',          // ← set your desired width
//   alignSelf: 'center',   // ← center the button horizontally
//   borderRadius: 25,
//   alignItems: 'center',
//   justifyContent: 'center',
//   marginTop: height * 0.04,
//   shadowColor: '#000',
//   shadowOffset: { width: 0, height: 2 },
//   shadowOpacity: 0.2,
//   shadowRadius: 4,
//   elevation: 3,
// },

//   buttonDisabled: {
//     backgroundColor: '#a0a0a0',
//     opacity: 0.7,
//   },
//   buttonText: {
//     color: 'white',
//     fontSize: width * 0.045,
//     fontWeight: 'bold',
//   },
//   forgotPasswordContainer: {
//     alignItems: 'center',
//     marginTop: height * 0.02,
//   },
//   forgotPasswordText: {
//     color: globalStyles.primaryColor.color,
//     fontSize: width * 0.035,
//     fontWeight: '500',
//   },
//   footer: {
//     paddingBottom: height * 0.03,
//     alignItems: 'center',
//     width: '100%',
//     marginTop: height * 0.05,
//   },
//   footerText: {
//     fontSize: width * 0.035,
//     color: '#a1a1a1',
//   },
//   footerCompany: {
//     fontWeight: '600',
//     fontSize: width * 0.04,
//     marginTop: height * 0.005,
//   },
// });



import React, { useState, useEffect } from 'react';
import { 
  View, Text, StyleSheet, TextInput, TouchableOpacity, Dimensions,
  KeyboardAvoidingView, Platform, ScrollView, Image, ActivityIndicator,
  Alert, Modal, ImageBackground
} from 'react-native';
import globalStyles from './globalStyles';
import CookieManager from '@react-native-cookies/cookies';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width, height } = Dimensions.get('window');

export default function Login({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);

  // 🔄 refresh auth token using refresh_token
  const refreshAuthToken = async () => {
    try {
      const response = await fetch('http://50.18.96.20/rpm-be/api/auth/refresh-token', {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        console.log("Refresh failed, logging out");
        navigation.replace('Login');
        return;
      }

      console.log("Auth token refreshed successfully");
    } catch (error) {
      console.error("Token refresh error:", error);
      navigation.replace('Login');
    }
  };

  // ⏲ setup interval to refresh token every 14 min
  useEffect(() => {
    const interval = setInterval(() => {
      refreshAuthToken();
    }, 14 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Please fill all fields');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('http://50.18.96.20/rpm-be/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const text = await response.text();
  console.log("Raw login response:", text);

  // Only parse JSON if it is valid
  let data;
  try {
        data = JSON.parse(text);
        } catch (e) {
            console.error('Failed to parse JSON:', e);
            setError('Server returned invalid response');
            return;
        }

        if (response.ok) {
            setShowOtpModal(true);
        } else {
            setError(data.message || 'Login failed. Please try again.');
        }
    } catch (error) {
      console.error('Login error:', error);
      setError('Network error. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpVerification = async () => {
    if (!otp || otp.length !== 6) {
      setError('Please enter a valid 6-digit OTP');
      return;
    }

    setIsVerifyingOtp(true);
    setError('');

    try {
      const response = await fetch('http://50.18.96.20/rpm-be/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email,
          otp,
          device_fingerprint: 'unique-browser-hash'
        }),
      });

      const data = await response.json();

      if (response.ok) {
        // ✅ check cookies
        const cookies = await CookieManager.get('http://50.18.96.20/rpm-be');
        console.log("Cookies after OTP:", cookies);

        Alert.alert('Success', 'Login successful!', [
          { 
            text: 'OK', 
            onPress: () => navigation.replace('Home')
          }
        ]);
      }
      const cookies = await CookieManager.get('http://50.18.96.20/rpm-be');
      const accessToken = cookies?.token?.value;
      const refreshToken = cookies?.refresh_token?.value;

      if (accessToken && refreshToken) {
        await AsyncStorage.setItem('token', accessToken);
        await AsyncStorage.setItem('refreshToken', refreshToken);
      } else {
        setError(data.message || 'Invalid OTP. Please try again.');
      }
    } catch (error) {
      console.error('OTP verification error:', error);
      setError('Network error. Please check your connection and try again.');
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        
       {/* 🔹 Background Image (Top Half) */}
      <View style={styles.backgroundWrapper}>
        <ImageBackground
          source={require('./assets/loginbk.png')}
          style={styles.backgroundImage}
          resizeMode="cover"
        >
          {/* Transparent overlay only for the background */}
          <View style={styles.backgroundOverlay} />

          {/* Logo stays on top with full opacity */}
          <Image
            source={require('./assets/infuzamed_logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </ImageBackground>
      </View>

        {/* 🔹 Form Container */}
        <View style={styles.formContainer}>
          {/* Email Field */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                setError('');
              }}
              placeholder="Enter your email"
              placeholderTextColor="#999"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          
          {/* Password Field */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                setError('');
              }}
              placeholder="Enter your password"
              placeholderTextColor="#999"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {/* Error Message */}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          
          {/* Login Button */}
          <TouchableOpacity 
            style={[styles.button, isLoading && styles.buttonDisabled]} 
            onPress={handleLogin}
            activeOpacity={0.8}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Login</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Developed By</Text>
          <Text style={[styles.footerText, styles.footerCompany]}>
            Revive Medical Technologies Inc.
          </Text>
        </View>
      </ScrollView>

      {/* OTP Verification Modal */}
      <Modal
        visible={showOtpModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowOtpModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>OTP Verification</Text>
            <Text style={styles.modalSubtitle}>
              Please enter the 6-digit OTP sent to your email
            </Text>
            
            <TextInput
              style={styles.otpInput}
              value={otp}
              onChangeText={(text) => {
                setOtp(text);
                setError('');
              }}
              placeholder="Enter OTP"
              placeholderTextColor="#999"
              keyboardType="numeric"
              maxLength={6}
            />
            
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  setShowOtpModal(false);
                  setOtp('');
                  setError('');
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.modalButton, styles.verifyButton, isVerifyingOtp && styles.buttonDisabled]}
                onPress={handleOtpVerification}
                disabled={isVerifyingOtp}
              >
                {isVerifyingOtp ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.verifyButtonText}>Verify</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  scrollContent: {
    flexGrow: 1,
  },
  backgroundWrapper: {
    width: '100%',
    height: '40%', // adjust if you want only top half
    borderBottomLeftRadius: '10%',
    borderBottomRightRadius: '10%',
    overflow: 'hidden',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
  },
  backgroundImage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backgroundOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.8)', // 0.85 → makes background appear ~0.15 opacity
    borderBottomLeftRadius: '10%',
    borderBottomRightRadius: '10%',
  },
  logo: {
    width: 350,
    height: 300,
    zIndex: 1, // keeps it above the overlay
  },
  formContainer: {
    paddingHorizontal: width * 0.1,
    marginTop: height * 0.03,
  },
  inputGroup: {
    marginBottom: height * 0.02,
  },
  label: {
    fontSize: width * 0.045,
    fontWeight: 'bold',
    color: '#2f2f2f',
    marginBottom: height * 0.01,
  },
  input: {
    width: '100%',
    fontSize: width * 0.04,
    padding: width * 0.04,
    borderRadius: 12,
    backgroundColor: '#ebf2f9',
    color: '#333',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  errorText: {
    color: '#e74c3c',
    fontSize: width * 0.035,
    marginTop: height * 0.01,
    textAlign: 'center',
    fontWeight: '500',
  },
  button: {
    backgroundColor: globalStyles.primaryColor.color,
    paddingVertical: height * 0.02,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: height * 0.04,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  buttonDisabled: {
    backgroundColor: '#a0a0a0',
    opacity: 0.7,
  },
  buttonText: {
    color: 'white',
    fontSize: width * 0.045,
    fontWeight: 'bold',
  },
  footer: {
    paddingBottom: height * 0.03,
    alignItems: 'center',
    width: '100%',
    marginTop: height * 0.08,
  },
  footerText: {
    fontSize: width * 0.035,
    color: '#a1a1a1',
  },
  footerCompany: {
    fontWeight: '600',
    fontSize: width * 0.04,
    marginTop: height * 0.005,
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    padding: 20,
  },
  modalContent: {
    width: '90%',
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 20,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: width * 0.05,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#2f2f2f',
  },
  modalSubtitle: {
    fontSize: width * 0.035,
    textAlign: 'center',
    marginBottom: 20,
    color: '#666',
  },
  otpInput: {
    width: '80%',
    fontSize: width * 0.05,
    padding: 15,
    borderRadius: 10,
    backgroundColor: '#f5f5f5',
    textAlign: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  modalButton: {
    flex: 1,
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginHorizontal: 5,
  },
  cancelButton: {
    backgroundColor: '#f1f1f1',
  },
  verifyButton: {
    backgroundColor: globalStyles.primaryColor.color,
  },
  cancelButtonText: {
    color: '#666',
    fontWeight: 'bold',
  },
  verifyButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
});