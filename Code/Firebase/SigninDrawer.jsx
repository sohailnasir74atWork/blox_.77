import React, { useCallback, useEffect, useState } from 'react';
import {
    Modal,
    View,
    Text,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    Pressable,
    ActivityIndicator,
    Platform,
    Image,
    Alert,
} from 'react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import Icon from 'react-native-vector-icons/FontAwesome'; // Ensure FontAwesome is installed
import appleAuth, { AppleButton } from '@invertase/react-native-apple-authentication';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useGlobalState } from '../GlobelStats';
import ConditionalKeyboardWrapper from '../Helper/keyboardAvoidingContainer';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage, showErrorMessage, showWarningMessage } from '../Helper/MessageHelper';
import { mixpanel } from '../AppHelper/MixPenel';
import { requestPermission } from '../Helper/PermissionCheck';
import { getApp } from '@react-native-firebase/app';
import {
    getAuth,
    sendPasswordResetEmail,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithCredential,
    GoogleAuthProvider,
    AppleAuthProvider,
    signOut,
    signInWithPhoneNumber,
} from '@react-native-firebase/auth';


const SignInDrawer = ({ visible, onClose, selectedTheme, message, screen }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [otpCode, setOtpCode] = useState('');
    const [confirmationResult, setConfirmationResult] = useState(null);
    const [otpSent, setOtpSent] = useState(false);
    const [isSendingOtp, setIsSendingOtp] = useState(false);
    const [isRegisterMode, setIsRegisterMode] = useState(false);
    const [isLoading, setIsLoading] = useState(false)
    const [isLoadingSecondary, setIsLoadingSecondary] = useState(false);
    const [robloxUsernameError, setRobloxUsernameError] = useState('');

    const { triggerHapticFeedback } = useHaptic();
    const { theme, robloxUsernameRef } = useGlobalState()
    const [robloxUsernamelocal, setRobloxUsernamelocal] = useState()
    useEffect(() => { robloxUsernameRef.current = robloxUsernamelocal }, [robloxUsernamelocal])
    // useEffect(()=>{setRobloxUsernamelocal()},[robloxUsernamelocal])
    const [isForgotPasswordMode, setIsForgotPasswordMode] = useState(false); // Track forgot password mode



    const { t } = useTranslation();
    // const appdatabase = getDatabase(app);
    const app = getApp();
    const auth = getAuth(app);

    useEffect(() => {
        robloxUsernameRef.current = robloxUsernamelocal;
    }, [robloxUsernamelocal, robloxUsernameRef]);

    const isDarkMode = theme === 'dark';
    useEffect(() => {
        GoogleSignin.configure({
            webClientId: '409137828081-ig2uul01r95lj9fu6l1jgbgrp1es9060.apps.googleusercontent.com',
            offlineAccess: true,
        });
    }, [])
    useEffect(() => {
        if (!appleAuth.isSupported) return;

        return appleAuth.onCredentialRevoked(async () => {
            try {
                await signOut(auth);
                showWarningMessage('Session Expired', 'Please sign in again.');
            } catch (e) {
                console.error('Error during signOut on Apple revoke:', e);
            }
        });
    }, [auth]);

    // const validateRobloxUsername = () => {
    //     if (Platform.OS === 'ios') return true; // ✅ Skip validation on iOS

    //     const name = robloxUsernameRef.current;
    //     if (!name || name.trim().length === 0) {
    //       setRobloxUsernameError('Roblox username is required');
    //       showErrorMessage(
    //         t("home.alert.error"),
    //         "Please enter your Roblox username."
    //       );
    //       return false;
    //     }
    //     setRobloxUsernameError('');
    //     return true;
    //   };

    // Reset phone state when toggling modes
    const resetPhoneState = () => {
        setPhoneNumber('');
        setOtpCode('');
        setConfirmationResult(null);
        setOtpSent(false);
    };

    const handleSendOtp = async () => {
        const cleaned = phoneNumber.trim();
        if (!cleaned || cleaned.length < 7) {
            Alert.alert(t("home.alert.error"), 'Please enter a valid phone number with country code (e.g. +1234567890)');
            return;
        }
        setIsSendingOtp(true);
        try {
            const result = await signInWithPhoneNumber(auth, cleaned);
            setConfirmationResult(result);
            setOtpSent(true);
            showSuccessMessage('Code Sent', `Verification code sent to ${cleaned}`);
        } catch (error) {
            showErrorMessage(t("home.alert.error"), error?.message || 'Failed to send SMS. Check the number and try again.');
        } finally {
            setIsSendingOtp(false);
        }
    };

    const handleForgotPassword = async () => {
        if (!email) {
            Alert.alert(t("home.alert.error"), 'Enter valid email address');
            return;
        }

        const isValidEmail = (email) => /\S+@\S+\.\S+/.test(email);
        if (!isValidEmail(email)) {
            Alert.alert(t("home.alert.error"), t("signin.error_input_message"));
            return;
        }

        setIsLoading(true);
        try {
            await sendPasswordResetEmail(auth, email);
            showSuccessMessage(t("home.alert.success"), t("signin.password_reset_email_sent"));
            setIsForgotPasswordMode(false); // Switch back to sign-in mode after success
        } catch (error) {
            showErrorMessage(t("home.alert.error"), error?.message || t("signin.error_reset_password"));
        } finally {
            setIsLoading(false);
        }
    };


    // Updated onAppleButtonPress function
    const onAppleButtonPress = useCallback(async () => {
        triggerHapticFeedback('impactLight');
        // if (!validateRobloxUsername()) return;


        try {
            const { identityToken, nonce } = await appleAuth.performRequest({
                requestedOperation: appleAuth.Operation.LOGIN,
                requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL],
            });

            if (!identityToken) throw new Error(t("signin.error_apple_token"));

            const appleCredential = AppleAuthProvider.credential(identityToken, nonce);
            await signInWithCredential(auth, appleCredential);

            showSuccessMessage(
                t("home.alert.success"),
                t("signin.success_signin")
            );
            if (Platform.OS !== 'ios') {
                setTimeout(() => {
                    onClose();
                }, 200);
            }
            mixpanel.track(`Login with apple from ${screen}`);
            await requestPermission()
        } catch (error) {
            showErrorMessage(
                t("home.alert.error"),
                error?.message || t("signin.error_signin_message")
            );
        }
    }, [auth, t, triggerHapticFeedback, onClose, screen]);




    const handleSignInOrRegister = async () => {
        triggerHapticFeedback('impactLight');

        if (!email || !password) {
            Alert.alert(t("home.alert.error"), t("signin.error_input_message"));
            return;
        }

        const isValidEmail = (email) => /\S+@\S+\.\S+/.test(email);
        if (!isValidEmail(email)) {
            Alert.alert(t("home.alert.error"), t("signin.error_input_message"));
            return;
        }

        // 🚫 Block disposable / temp email domains
        const TEMP_EMAIL_DOMAINS = new Set([
            'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org',
            'guerrillamail.biz', 'guerrillamail.de', 'guerrillamail.info', 'grr.la',
            'sharklasers.com', 'guerrillamailblock.com', 'spam4.me', 'trashmail.com',
            'trashmail.at', 'trashmail.io', 'trashmail.me', 'trashmail.net', 'trashmail.org',
            'trashmail.xyz', 'mailnull.com', 'spamgourmet.com', 'spamgourmet.net',
            'spamgourmet.org', 'yopmail.com', 'yopmail.fr', 'cool.fr.nf', 'jetable.fr.nf',
            'nospam.ze.tc', 'nomail.xl.cx', 'mega.zik.dj', 'speed.1s.fr', 'courriel.fr.nf',
            'moncourrier.fr.nf', 'monemail.fr.nf', 'monmail.fr.nf', 'tempmail.com',
            'tempmail.net', 'tempmail.org', 'temp-mail.org', 'temp-mail.io', 'dispostable.com',
            'throwam.com', 'owlpic.com', 'fakeinbox.com', 'mailnesia.com', 'maildrop.cc',
            'discard.email', 'spambog.com', 'throwam.com', 'spamfree24.org', 'spamfree24.de',
            'spamfree24.eu', 'spamfree24.info', 'spamfree24.net', 'spam.la', 'spam.su',
            'trash-mail.at', 'filzmail.com', 'throwam.com', 'getairmail.com', 'filzmail.com',
            'anon-mail.de', 'objectmail.com', 'obobbo.com', 'rcpt.at', 'rfc822.org',
            'rhyta.com', 'spamday.com', 'spamfree.eu', 'spamgoes.in', 'spamgoes.org',
            'spamrap.com', 'spaml.com', 'spamoff.de', 'spaun.ml', 'maileater.com',
            'mailexpire.com', 'mailfreeonline.com', 'mailguard.me', 'mailhazard.com',
            'mailinater.com', 'mailincubator.com', 'mailinator2.com', 'mailme24.com',
            'mailmetrash.com', 'mailmoat.com', 'mailnew.com', 'mailnull.com', 'mailsac.com',
            'mailshell.com', 'mailslapping.com', 'mailslite.com', 'mailsiphon.com',
            'mailslapping.com', 'mailtemp.info', 'mailtemp.net', 'mailzilla.org',
            'throwam.com', 'spamgoes.in', 'deadaddress.com', 'dispostable.com',
            'filzmail.com', 'harakirimail.com', 'inoutmail.de', 'mail.mezimages.net',
            'maildrop.cc', 'mailexpire.com', 'mailguard.me', 'nomail.pw', 'slopsbox.com',
            'spaml.de', 'trbvm.com', 'trashmailer.com', 'wegwerfmail.de', 'yopmail.pp.ua',
        ]);
        if (isRegisterMode) {
            const emailDomain = email.toLowerCase().split('@')[1];
            if (TEMP_EMAIL_DOMAINS.has(emailDomain)) {
                Alert.alert(
                    t("home.alert.error"),
                    "Temporary or disposable email addresses are not allowed. Please use a real email address (Gmail, Outlook, Yahoo, etc.)."
                );
                return;
            }
        }

        setIsLoadingSecondary(true);

        try {
            if (isRegisterMode) {
                // Step 1: Verify phone OTP first
                if (!confirmationResult || !otpSent) {
                    Alert.alert(t("home.alert.error"), 'Please verify your phone number first.');
                    setIsLoadingSecondary(false);
                    return;
                }
                try {
                    await confirmationResult.confirm(otpCode.trim());
                } catch {
                    Alert.alert(t("home.alert.error"), 'Invalid verification code. Please try again.');
                    setIsLoadingSecondary(false);
                    return;
                }
                // 🔐 Register new user
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                // Send verification email FIRST (must be signed in)
                await user.sendEmailVerification();
                // Then sign out — user must verify email before they can log in
                await signOut(auth);

                Alert.alert(
                    '✅ Account Created',
                    'Please check your inbox to verify your email. If you don\'t see it, check the Spam or Promotions folder.'
                );
                resetPhoneState();
                return;

            } else {
                // 🔐 Login existing user
                const userCredential = await signInWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                if (!user.emailVerified) {
                    await user.sendEmailVerification();
                    await signOut(auth);

                    Alert.alert(
                        "📩 Email Not Verified",
                        "A new verification link has been sent to your email. Please check your inbox or spam folder before signing in."
                    );
                    return;
                }

                // ✅ Verified user
                mixpanel.track(`Login with email from ${screen}`);
                Alert.alert(t("signin.alert_welcome_back"), t("signin.success_signin"));
                await requestPermission();
                if (Platform.OS !== 'ios') {
                    setTimeout(() => {
                        onClose();
                    }, 200);
                }
            }

        } catch (error) {
            console.error(t("signin.auth_error"), error);

            let errorMessage = t("signin.error_signin_message");

            if (error?.code === 'auth/invalid-email') errorMessage = t("signin.error_invalid_email_format");
            else if (error?.code === 'auth/user-disabled') errorMessage = t("signin.error_user_disabled");
            else if (error?.code === 'auth/user-not-found') errorMessage = t("signin.error_user_not_found");
            else if (error?.code === 'auth/wrong-password') errorMessage = t("signin.error_wrong_password");
            else if (error?.code === 'auth/email-already-in-use') errorMessage = t("signin.error_email_in_use");
            else if (error?.code === 'auth/weak-password') errorMessage = t("signin.error_weak_password");

            Alert.alert(t("signin.error_signin_message"), errorMessage);
        } finally {
            setIsLoadingSecondary(false);
        }
    };




    const handleGoogleSignIn = useCallback(async () => {
        triggerHapticFeedback('impactLight');

        try {
            setIsLoading(true);
            await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
            const signInResult = await GoogleSignin.signIn();
            const idToken = signInResult?.idToken || signInResult?.data?.idToken;
            if (!idToken) throw new Error(t("signin.error_signin_message"));

            const googleCredential = GoogleAuthProvider.credential(idToken);
            await signInWithCredential(auth, googleCredential);

            showSuccessMessage(
                t("signin.alert_welcome_back"),
                t("signin.success_signin")
            );
            if (Platform.OS !== 'ios') {
                setTimeout(() => {
                    onClose();
                }, 200);
            }
            mixpanel.track(`Login with google from ${screen}`);
            await requestPermission();


        } catch (error) {
            // console.log(error)
            showErrorMessage(
                t("home.alert.error"),
                error?.message || t("signin.error_signin_message")
            );
            // await requestPermission()

        } finally {
            setIsLoading(false);
        }
    }, []);



    return (
        <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
            <Pressable style={styles.modalOverlay} onPress={onClose} />
            <ConditionalKeyboardWrapper>
                <Pressable onPress={() => { }}>
                    <View style={[styles.drawer, { backgroundColor: isDarkMode ? '#3B404C' : 'white' }]}>
                        <Text style={[styles.title, { color: selectedTheme.colors.text }]}>
                            {isRegisterMode ? t("signin.title_register") : isForgotPasswordMode ? 'Forget Password' : t("signin.title_signin")}
                        </Text>
                        <View>
                            <Text style={[styles.text, { color: selectedTheme.colors.text }]}>
                                {message}
                            </Text>
                        </View>
                        {/* <TextInput
  style={[styles.input, { color: selectedTheme.colors.text }]}
  placeholder="Roblox Username"
  value={robloxUsername}
  onChangeText={setRobloxUsername}
  autoCapitalize="none"
  placeholderTextColor={selectedTheme.colors.text}
/> */}

                        {/* {Platform.OS !== 'ios' && (
  <>
    <TextInput
      style={[
        styles.input,
        {
          color: selectedTheme.colors.text,
          marginBottom: robloxUsernameError ? 0 : 15,
          borderColor: robloxUsernameError ? 'red' : 'grey',
        },
      ]}
      placeholder="Roblox Username *"
      value={robloxUsernamelocal}
      onChangeText={(text) => {
        setRobloxUsernamelocal(text);
        if (robloxUsernameError) {
          setRobloxUsernameError('');
        }
      }}
      autoCapitalize="none"
      placeholderTextColor={selectedTheme.colors.text}
    />
    {robloxUsernameError ? (
      <Text style={[styles.errorText, { color: 'red', marginBottom: 15 }]}>
        {robloxUsernameError}
      </Text>
    ) : null}
    <View style={styles.container}>
                        <View style={styles.line} />
                        <Image
  source={require('../../assets/roblox.png')}

  style={{ width: 24, height: 24 }}
  resizeMode="contain"
/>
                        <View style={styles.line} />
                    </View>
  </>
)} */}



                        {!isForgotPasswordMode && <TextInput
                            style={[styles.input, { color: selectedTheme.colors.text }]}
                            placeholder={t("signin.placeholder_email")}
                            value={email}
                            onChangeText={setEmail}
                            keyboardType="email-address"
                            autoCapitalize="none"
                            placeholderTextColor={selectedTheme.colors.text}
                        />}

                        {!isForgotPasswordMode && <TextInput
                            style={[styles.input, { color: selectedTheme.colors.text }]}
                            placeholder={t("signin.placeholder_password")}
                            value={password}
                            onChangeText={setPassword}
                            secureTextEntry
                            placeholderTextColor={selectedTheme.colors.text}
                        />}

                        {/* ── Phone verification — register mode only ── */}
                        {isRegisterMode && !isForgotPasswordMode && (
                            <View style={{ marginTop: 10 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                    <TextInput
                                        style={[
                                            styles.input,
                                            {
                                                flex: 1, marginTop: 0, color: selectedTheme.colors.text,
                                                borderColor: otpSent ? '#29AB87' : 'grey'
                                            },
                                        ]}
                                        placeholder="+1234567890 (with country code)"
                                        value={phoneNumber}
                                        onChangeText={setPhoneNumber}
                                        keyboardType="phone-pad"
                                        editable={!otpSent}
                                        placeholderTextColor={selectedTheme.colors.text}
                                    />
                                    <TouchableOpacity
                                        onPress={otpSent ? () => { setOtpSent(false); setConfirmationResult(null); setOtpCode(''); } : handleSendOtp}
                                        disabled={isSendingOtp}
                                        style={{
                                            backgroundColor: otpSent ? '#555' : '#29AB87',
                                            paddingHorizontal: 12, paddingVertical: 10,
                                            borderRadius: 6, alignItems: 'center',
                                        }}
                                    >
                                        {isSendingOtp
                                            ? <ActivityIndicator size="small" color="white" />
                                            : <Text style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>
                                                {otpSent ? 'Resend' : 'Send Code'}
                                            </Text>
                                        }
                                    </TouchableOpacity>
                                </View>

                                {otpSent && (
                                    <View style={{ marginTop: 8 }}>
                                        <TextInput
                                            style={[styles.input, { marginTop: 0, color: selectedTheme.colors.text, borderColor: '#29AB87' }]}
                                            placeholder="Enter 6-digit code"
                                            value={otpCode}
                                            onChangeText={setOtpCode}
                                            keyboardType="number-pad"
                                            maxLength={6}
                                            placeholderTextColor={selectedTheme.colors.text}
                                        />
                                        <Text style={{ fontSize: 11, color: '#29AB87', marginTop: 4 }}>
                                            ✅ Code sent! Enter it above then tap Register.
                                        </Text>
                                    </View>
                                )}
                            </View>
                        )}
                        {isForgotPasswordMode && (
                            <TextInput
                                style={[styles.input, { color: selectedTheme.colors.text }]}
                                placeholder={t("signin.placeholder_email")}
                                value={email}
                                onChangeText={setEmail}
                                keyboardType="email-address"
                                autoCapitalize="none"
                                placeholderTextColor={selectedTheme.colors.text}
                            />
                        )}
                        <TouchableOpacity
                            style={[styles.secondaryButton, { alignItems: 'flex-end', paddingBottom: 10 }]}
                            onPress={() => setIsForgotPasswordMode(!isForgotPasswordMode)} // Toggle mode
                        >
                            <Text style={styles.secondaryButtonText}>
                                {isForgotPasswordMode ? 'Signin Mode' : 'Forgetpassword Mode'}
                            </Text>
                        </TouchableOpacity>

                        {isForgotPasswordMode ? (
                            <TouchableOpacity
                                style={styles.primaryButton}
                                onPress={handleForgotPassword}
                                disabled={isLoading}
                            >
                                {isLoading ? (
                                    <ActivityIndicator size="small" color="white" />
                                ) : (
                                    <Text style={styles.primaryButtonText}>Send Reset Link</Text>
                                )}
                            </TouchableOpacity>
                        ) : (
                            <TouchableOpacity
                                style={styles.primaryButton}
                                onPress={handleSignInOrRegister}
                                disabled={isLoadingSecondary}
                            >
                                {isLoadingSecondary ? (
                                    <ActivityIndicator size="small" color="white" />
                                ) : (
                                    <Text style={styles.primaryButtonText}>
                                        {isRegisterMode ? t("signin.title_register") : t("signin.title_signin")}
                                    </Text>
                                )}
                            </TouchableOpacity>
                        )}





                        <View style={styles.container}>
                            <View style={styles.line} />
                            <Text style={[styles.textoR, { color: selectedTheme.colors.text }]}>
                                {t("signin.or")}
                            </Text>
                            <View style={styles.line} />
                        </View>


                        <TouchableOpacity
                            style={styles.googleButton}
                            onPress={() => handleGoogleSignIn()}
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <ActivityIndicator size="small" color="white" />
                            ) : (
                                <>
                                    <Icon name="google" size={20} color="white" style={styles.googleIcon} />
                                    <Text style={styles.googleButtonText}>{t("signin.google_signin")}</Text>
                                </>
                            )}
                        </TouchableOpacity>

                        {Platform.OS === 'ios' && (
                            <AppleButton
                                buttonStyle={isDarkMode ? AppleButton.Style.WHITE : AppleButton.Style.BLACK}
                                buttonType={AppleButton.Type.SIGN_IN}
                                style={styles.applebUUTON}
                                onPress={() => onAppleButtonPress().then(() => {/* console.log('Apple sign-in complete!') */ })}
                            />
                        )}

                        <TouchableOpacity
                            style={styles.secondaryButton}
                            onPress={() => { if (!isForgotPasswordMode) { setIsRegisterMode(!isRegisterMode); resetPhoneState(); } }}
                        >
                            <Text style={styles.secondaryButtonText}>
                                {isRegisterMode ? t("signin.button_switch_signin") : t("signin.button_switch_register")}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </Pressable>
            </ConditionalKeyboardWrapper>
        </Modal>

    );
};

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
    },
    drawer: {
        borderTopLeftRadius: 10,
        borderTopRightRadius: 10,
        paddingHorizontal: 20,
        paddingTop: 20,
        // height: 400,
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
    },
    title: {
        fontSize: 18,
        fontWeight: 'bold',
        textAlign: 'center',
    },
    input: {
        width: '100%',
        height: 40,
        borderColor: 'grey',
        borderWidth: 1,
        borderRadius: 5,
        paddingHorizontal: 10,
        marginTop: 15,
    },
    primaryButton: {
        backgroundColor: '#007BFF',
        padding: 10,
        borderRadius: 5,
        alignItems: 'center',
        // marginBottom: 10,
    },
    primaryButtonText: {
        color: 'white',
        fontWeight: 'bold',
    },
    secondaryButton: {
        padding: 10,
        alignItems: 'center',
        // marginBottom: 10,
    },
    secondaryButtonText: {
        color: '#007BFF',
        textDecorationLine: 'underline',
    },
    googleButton: {
        flexDirection: 'row', // Ensures the icon and text are in a row
        alignItems: 'center', // Vertically centers the content
        justifyContent: 'center', // Centers content horizontally
        backgroundColor: '#DB4437', // Google brand red color
        padding: 10,
        borderRadius: 5,
        marginBottom: 10,
        height: 40,


    },
    applebUUTON: {
        height: 40,
        width: '100%',
        // marginBottom: 10,
    },
    googleIcon: {
        marginRight: 10, // Space between the icon and the text
    },
    googleButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold',
    },
    closeText: {
        color: 'white',
    },
    text: {
        alignSelf: 'center',
        fontSize: 12,
        paddingVertical: 3,
        marginBottom: 10
    },
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 10, // Adjust spacing
    },
    line: {
        flex: 1,
        height: 1,
        backgroundColor: '#ccc', // Adjust color
    },
    textoR: {
        marginHorizontal: 10, // Spacing around the text
        fontSize: 16,
        fontWeight: 'bold',
    },
    errorText: {
        fontSize: 12,
        marginTop: 5,
        marginLeft: 5,
    },
});

export default SignInDrawer;





