import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ConditionalKeyboardWrapper from '../Helper/keyboardAvoidingContainer';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage, showErrorMessage, showWarningMessage } from '../Helper/MessageHelper';
import { requestPermission } from '../Helper/PermissionCheck';
import { setPendingSigninChoice, clearPendingSigninChoice } from '../Helper/emailOptIn';
import { handleOpenPrivacy, handleOpenTerms } from '../SettingScreen/settinghelper';
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
    onAuthStateChanged,
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
    const insets = useSafeAreaInsets();
    const { theme, robloxUsernameRef, user } = useGlobalState()
    const [robloxUsernamelocal, setRobloxUsernamelocal] = useState()
    useEffect(() => { robloxUsernameRef.current = robloxUsernamelocal }, [robloxUsernamelocal])
    // useEffect(()=>{setRobloxUsernamelocal()},[robloxUsernamelocal])
    const [isForgotPasswordMode, setIsForgotPasswordMode] = useState(false); // Track forgot password mode
    // Email news-and-updates opt-in. Must start unticked: a pre-ticked box is
    // not valid consent under GDPR/UK law. Applied by EmailOptInGate after
    // sign-in, which also runs the 13+ check. Read through a ref because
    // handleGoogleSignIn's useCallback has no deps.
    const [emailUpdates, setEmailUpdates] = useState(false);
    const emailUpdatesRef = useRef(false);
    useEffect(() => { emailUpdatesRef.current = emailUpdates; }, [emailUpdates]);
    // Consent is per sign-in: a tick left from an earlier, abandoned attempt
    // must not carry over, so the box resets whenever the drawer closes.
    useEffect(() => { if (!visible) setEmailUpdates(false); }, [visible]);



    const { t } = useTranslation();
    // const appdatabase = getDatabase(app);
    const app = getApp();
    const auth = getAuth(app);

    // Opened while Firebase already holds a session whose profile is still
    // loading (a slow login after the 3 s splash cap): this player IS signed
    // in, so show "loading your account" instead of the sign-in form, and close
    // by itself once the profile lands. Decided when the drawer opens only, so
    // a sign-in that starts inside the drawer is never affected.
    const [restoring, setRestoring] = useState(false);
    useEffect(() => {
        setRestoring(visible && !!auth.currentUser && !user?.id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible]);
    useEffect(() => {
        if (restoring && user?.id) {
            setRestoring(false);
            onClose?.();
        }
    }, [restoring, user?.id, onClose]);
    useEffect(() => {
        if (!restoring) return undefined;
        // The session went away instead (e.g. unverified email): show the form.
        return onAuthStateChanged(auth, (u) => { if (!u) setRestoring(false); });
    }, [restoring, auth]);

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
        setPendingSigninChoice(emailUpdatesRef.current);
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
            await requestPermission()
        } catch (error) {
            // Keep the choice if sign-in itself went through and only a later
            // step (the notification permission request) threw.
            if (!auth.currentUser) clearPendingSigninChoice();
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
                // Registration signs straight back out; the choice applies at sign-in.
                clearPendingSigninChoice();
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
                setPendingSigninChoice(emailUpdatesRef.current);
                const userCredential = await signInWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                if (!user.emailVerified) {
                    clearPendingSigninChoice();
                    await user.sendEmailVerification();
                    await signOut(auth);

                    Alert.alert(
                        "📩 Email Not Verified",
                        "A new verification link has been sent to your email. Please check your inbox or spam folder before signing in."
                    );
                    return;
                }

                // ✅ Verified user
                Alert.alert(t("signin.alert_welcome_back"), t("signin.success_signin"));
                await requestPermission();
                if (Platform.OS !== 'ios') {
                    setTimeout(() => {
                        onClose();
                    }, 200);
                }
            }

        } catch (error) {
            // Keep the choice if sign-in itself went through and only a later
            // step (the notification permission request) threw.
            if (!auth.currentUser) clearPendingSigninChoice();
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
        setPendingSigninChoice(emailUpdatesRef.current);

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
            await requestPermission();


        } catch (error) {
            // Keep the choice if sign-in itself went through and only a later
            // step (the notification permission request) threw.
            if (!auth.currentUser) clearPendingSigninChoice();
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



    if (visible && restoring) {
        return (
            <Modal visible animationType="slide" transparent onRequestClose={onClose}>
                <Pressable style={styles.modalOverlay} onPress={onClose} />
                <View style={[styles.drawer, { backgroundColor: isDarkMode ? '#3B404C' : 'white', paddingBottom: insets.bottom + 16 }]}>
                    <View style={styles.restoringBox}>
                        <ActivityIndicator size="large" color={selectedTheme.colors.text} />
                        <Text style={[styles.text, styles.restoringText, { color: selectedTheme.colors.text }]}>{t('signin.restoring')}</Text>
                    </View>
                </View>
            </Modal>
        );
    }

    return (
        <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
            <Pressable style={styles.modalOverlay} onPress={onClose} />
            <ConditionalKeyboardWrapper>
                <Pressable onPress={() => { }}>
                    <View style={[styles.drawer, { backgroundColor: isDarkMode ? '#3B404C' : 'white', paddingBottom: insets.bottom + 16 }]}>
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

                        {!isForgotPasswordMode && (
                            <TouchableOpacity
                                style={styles.optInRow}
                                onPress={() => setEmailUpdates((v) => !v)}
                                activeOpacity={0.7}
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: emailUpdates }}
                            >
                                <View style={[styles.checkbox, emailUpdates && styles.checkboxChecked]}>
                                    {emailUpdates && <Icon name="check" size={12} color="white" />}
                                </View>
                                <Text style={[styles.optInText, { color: selectedTheme.colors.text }]}>
                                    {t('signin.email_updates_optin', { defaultValue: 'Email me news and updates (optional)' })}
                                </Text>
                            </TouchableOpacity>
                        )}

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

                        <Text style={[styles.legalText, { color: selectedTheme.colors.text }]}>
                            {t('signin.legal_prefix', { defaultValue: 'By continuing, you agree to our ' })}
                            <Text style={styles.legalLink} onPress={handleOpenTerms}>
                                {t('signin.legal_terms', { defaultValue: 'Terms' })}
                            </Text>
                            {t('signin.legal_and', { defaultValue: ' and ' })}
                            <Text style={styles.legalLink} onPress={handleOpenPrivacy}>
                                {t('signin.legal_privacy', { defaultValue: 'Privacy Policy' })}
                            </Text>
                            .
                        </Text>
                    </View>
                </Pressable>
            </ConditionalKeyboardWrapper>
        </Modal>

    );
};

const styles = StyleSheet.create({
    optInRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        marginBottom: 6,
    },
    checkbox: {
        width: 20,
        height: 20,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: 'grey',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 10,
    },
    checkboxChecked: {
        backgroundColor: '#007BFF',
        borderColor: '#007BFF',
    },
    optInText: {
        flex: 1,
        fontSize: 13,
    },
    legalText: {
        fontSize: 11,
        textAlign: 'center',
        opacity: 0.7,
        marginTop: 8,
        lineHeight: 16,
    },
    legalLink: {
        textDecorationLine: 'underline',
    },
    restoringBox: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 36,
    },
    restoringText: {
        marginTop: 12,
    },
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





