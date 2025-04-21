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
} from 'react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import auth from '@react-native-firebase/auth';
import Icon from 'react-native-vector-icons/FontAwesome'; // Ensure FontAwesome is installed
import appleAuth, { AppleButton } from '@invertase/react-native-apple-authentication';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useGlobalState } from '../GlobelStats';
import ConditionalKeyboardWrapper from '../Helper/keyboardAvoidingContainer';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage, showErrorMessage, showWarningMessage } from '../Helper/MessageHelper';
import { mixpanel } from '../AppHelper/MixPenel';



const SignInDrawer = ({ visible, onClose, selectedTheme, message, screen }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isRegisterMode, setIsRegisterMode] = useState(false);
    const [isLoading, setIsLoading] = useState(false)
    const [isLoadingSecondary, setIsLoadingSecondary] = useState(false);
    const [robloxUsernameError, setRobloxUsernameError] = useState('');
    const { triggerHapticFeedback } = useHaptic();
    const { theme, robloxUsernameRef } = useGlobalState()
    const [robloxUsernamelocal, setRobloxUsernamelocal] = useState()
    useEffect(()=>{robloxUsernameRef.current = robloxUsernamelocal},[robloxUsernamelocal])
    // useEffect(()=>{setRobloxUsernamelocal()},[robloxUsernamelocal])


    const { t } = useTranslation();
    // const appdatabase = getDatabase(app);
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
            await auth().signOut();
            showWarningMessage("Session Expired", "Please sign in again.");
        });
    }, []);
    
    
    const validateRobloxUsername = () => {
        const name = robloxUsernameRef.current;
        if (!name || name.trim().length === 0) {
          setRobloxUsernameError('Roblox username is required');
          showErrorMessage(
            t("home.alert.error"),
            "Please enter your Roblox username."
          );
          return false;
        }
        setRobloxUsernameError('');
        return true;
    };
      

    // Updated onAppleButtonPress function
    const onAppleButtonPress = useCallback(async () => {
        triggerHapticFeedback('impactLight');
        if (!validateRobloxUsername()) return;


        try {
            const { identityToken, nonce } = await appleAuth.performRequest({
                requestedOperation: appleAuth.Operation.LOGIN,
                requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL],
            });
    
            if (!identityToken) throw new Error(t("signin.error_apple_token"));
    
            await auth().signInWithCredential(auth.AppleAuthProvider.credential(identityToken, nonce));
            showSuccessMessage(
                t("home.alert.success"),
                t("signin.success_signin")
            );
            onClose();
            mixpanel.track(`Login with apple from ${screen}`);
        } catch (error) {
            showErrorMessage(
                t("home.alert.error"),
                error?.message || t("signin.error_signin_message")
            );
        }
    }, [t, triggerHapticFeedback, onClose]);
    
    
    
    const handleSignInOrRegister = async () => {
        triggerHapticFeedback('impactLight');
        if (!validateRobloxUsername()) return;

    
        if (!email || !password) {
            // Alert.alert(t("home.alert.error"), t("signin.error_input_message"));
            showErrorMessage(
                t("home.alert.error"),
                t("signin.error_input_message")
            );
            return;
        }
    
        const isValidEmail = (email) => /\S+@\S+\.\S+/.test(email);
    
        if (!isValidEmail(email)) {
            // Alert.alert(t("home.alert.error"), t("signin.error_input_message"));
            showErrorMessage(
                t("home.alert.error"),
                t("signin.error_input_message")
            );
            return;
        }
    
        setIsLoadingSecondary(true); // Show loading indicator
    
        try {
            if (isRegisterMode) {
                // Handle user registration
                // await updateLocalState('user_name', robloxUsernamelocal)
                await auth().createUserWithEmailAndPassword(email, password);
                // Alert.alert(t("signin.alert_success"), t("signin.alert_account_created"));
                mixpanel.track(`Login with email from ${screen}`);

                showSuccessMessage(
                    t("home.alert.success"),
                    t("signin.alert_account_created")
                );
                  onClose(); // Close modal after successful operation

            } else {
                // Handle user login
                await auth().signInWithEmailAndPassword(email, password);
                mixpanel.track(`Login with email from ${screen}`);
                onClose(); // Close modal after successful operation

                // Alert.alert(t("signin.alert_welcome_back"), t("signin.success_signin"));
                showSuccessMessage(
                    t("signin.alert_welcome_back"),
                    t("signin.success_signin")
                );
            }
    
        } catch (error) {
            console.error(t("signin.auth_error"), error);
    
            let errorMessage = t("signin.error_signin_message");
    
            if (error?.code === 'auth/invalid-email') {
                errorMessage = t("signin.error_invalid_email_format");
            } else if (error?.code === 'auth/user-disabled') {
                errorMessage = t("signin.error_user_disabled");
            } else if (error?.code === 'auth/user-not-found') {
                errorMessage = t("signin.error_user_not_found");
            } else if (error?.code === 'auth/wrong-password') {
                errorMessage = t("signin.error_wrong_password");
            } else if (error?.code === 'auth/email-already-in-use') {
                errorMessage = t("signin.error_wrong_password");
            } else if (error?.code === 'auth/weak-password') {
                errorMessage = t("signin.error_weak_password");
            }
    
            // Alert.alert(t("signin.error_signin_message"), errorMessage);
            showErrorMessage(
                t("signin.error_signin_message"),
                errorMessage
            );
        } finally {
            setIsLoadingSecondary(false); // Hide loading indicator
        }
    };
    
    const handleGoogleSignIn = useCallback(async () => {
        if (!validateRobloxUsername()) return;
        try {
            setIsLoading(true);
            await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
            const signInResult = await GoogleSignin.signIn();            
            const idToken = signInResult?.idToken || signInResult?.data?.idToken;
            if (!idToken) throw new Error(t("signin.error_signin_message"));
    
            await auth().signInWithCredential(auth.GoogleAuthProvider.credential(idToken));
            showSuccessMessage(
                t("signin.alert_welcome_back"),
                t("signin.success_signin")
            );
            onClose()
            mixpanel.track(`Login with google from ${screen}`);

        } catch (error) {
            showErrorMessage(
                t("home.alert.error"),
                error?.message || t("signin.error_signin_message")
            );
        } finally {
            setIsLoading(false);
        }
    }, [onClose]);
    
    

    return (
        <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <Pressable style={styles.modalOverlay} onPress={onClose} />
        <ConditionalKeyboardWrapper>
            <Pressable onPress={() => { }}>
                <View style={[styles.drawer, { backgroundColor: isDarkMode ? '#3B404C' : 'white' }]}>
                    <Text style={[styles.title, { color: selectedTheme.colors.text }]}>
                        {isRegisterMode ? t("signin.title_register") : t("signin.title_signin")}
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

<TextInput
  style={[
    styles.input, 
    { 
      color: selectedTheme.colors.text, 
      marginBottom: robloxUsernameError ? 0 : 15,
      borderColor: robloxUsernameError ? 'red' : 'grey'
    }
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
    
                    <TextInput
                        style={[styles.input, { color: selectedTheme.colors.text }]}
                        placeholder={t("signin.placeholder_email")}
                        value={email}
                        onChangeText={setEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        placeholderTextColor={selectedTheme.colors.text}
                    />
    
                    <TextInput
                        style={[styles.input, { color: selectedTheme.colors.text }]}
                        placeholder={t("signin.placeholder_password")}
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                        placeholderTextColor={selectedTheme.colors.text}
                    />
    
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
                            onPress={() => onAppleButtonPress().then(() => console.log('Apple sign-in complete!'))}
                        />
                    )}
    
                    <TouchableOpacity
                        style={styles.secondaryButton}
                        onPress={() => setIsRegisterMode(!isRegisterMode)}
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
        fontFamily: 'Lato-Bold',
        textAlign: 'center',
    },
    input: {
        width: '100%',
        height: 40,
        borderColor: 'grey',
        borderWidth: 1,
        borderRadius: 5,
        paddingHorizontal: 10,
        marginBottom: 15,
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
        fontFamily: 'Lato-Bold',
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
        fontFamily: 'Lato-Bold',
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
        fontFamily: 'Lato-Bold',
    },
    errorText: {
        fontSize: 12,
        marginTop: 5,
        marginLeft: 5,
    },
});

export default SignInDrawer;
