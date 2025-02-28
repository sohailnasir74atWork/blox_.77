import React, { useEffect, useState } from 'react';
import {
    Modal,
    View,
    Text,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    Pressable,
    ActivityIndicator,
    Alert,
    Platform,
} from 'react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import auth from '@react-native-firebase/auth';
import Icon from 'react-native-vector-icons/FontAwesome'; // Ensure FontAwesome is installed
import appleAuth, { AppleButton } from '@invertase/react-native-apple-authentication';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useGlobalState } from '../GlobelStats';
import ConditionalKeyboardWrapper from '../Helper/keyboardAvoidingContainer';
import { useTranslation } from 'react-i18next';
import { showMessage } from 'react-native-flash-message';



const SignInDrawer = ({ visible, onClose, selectedTheme, message }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isRegisterMode, setIsRegisterMode] = useState(false);
    const [isLoading, setIsLoading] = useState(false)
    const [isLoadingSecondary, setIsLoadingSecondary] = useState(false);
    const { triggerHapticFeedback } = useHaptic();
    const { theme } = useGlobalState()
    const { t } = useTranslation();


    // const appdatabase = getDatabase(app);
    const isDarkMode = theme === 'dark';
    useEffect(() => {
        GoogleSignin.configure({
            webClientId: '409137828081-ig2uul01r95lj9fu6l1jgbgrp1es9060.apps.googleusercontent.com',
            offlineAccess: true,
        });
    }, [])


 

    // Updated onAppleButtonPress function
    async function onAppleButtonPress() {
        triggerHapticFeedback('impactLight');
        try {
            const appleAuthRequestResponse = await appleAuth.performRequest({
                requestedOperation: appleAuth.Operation.LOGIN,
                requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL],
            });
    
            const { identityToken, nonce } = appleAuthRequestResponse;
    
            if (!identityToken) {
                throw new Error(t("signin.error_apple_token"));
            }
    
            const appleCredential = auth.AppleAuthProvider.credential(identityToken, nonce);
            await auth().signInWithCredential(appleCredential);
    
            // Alert.alert(t("home.alert.success"), t("signin.success_signin"));
            showMessage({
                message: t("home.alert.success"),
                description:t("signin.success_signin"),
                type: "success",
              });
            onClose(); // Close the modal on success
        } catch (error) {
            // console.error(t("signin.error_apple_signin"), error);
            // Alert.alert(t("home.alert.error"), error?.message || t("signin.error_signin_message"));
            showMessage({
                message: t("home.alert.error"),
                description:error?.message || t("signin.error_signin_message"),
                type: "danger",
              });
        }
    }
    
    
    const handleSignInOrRegister = async () => {
        triggerHapticFeedback('impactLight');
    
        if (!email || !password) {
            // Alert.alert(t("home.alert.error"), t("signin.error_input_message"));
            showMessage({
                message: t("home.alert.error"),
                description:t("signin.error_input_message"),
                type: "danger",
              });
            return;
        }
    
        const isValidEmail = (email) => /\S+@\S+\.\S+/.test(email);
    
        if (!isValidEmail(email)) {
            // Alert.alert(t("home.alert.error"), t("signin.error_input_message"));
            showMessage({
                message: t("home.alert.error"),
                description:t("signin.error_input_message"),
                type: "danger",
              });
            return;
        }
    
        setIsLoadingSecondary(true); // Show loading indicator
    
        try {
            if (isRegisterMode) {
                // Handle user registration
                await auth().createUserWithEmailAndPassword(email, password);
                // Alert.alert(t("signin.alert_success"), t("signin.alert_account_created"));
                showMessage({
                    message: t("home.alert.success"),
                    description:t("signin.alert_account_created"),
                    type: "success",
                  });
            } else {
                // Handle user login
                await auth().signInWithEmailAndPassword(email, password);
                // Alert.alert(t("signin.alert_welcome_back"), t("signin.success_signin"));
                showMessage({
                    message: t("signin.alert_welcome_back"),
                    description:t("signin.success_signin"),
                    type: "success",
                  });
            }
    
            onClose(); // Close modal after successful operation
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
            showMessage({
                message: t("signin.error_signin_message"),
                description:errorMessage,
                type: "danger",
              });
        } finally {
            setIsLoadingSecondary(false); // Hide loading indicator
        }
    };
    
    const handleGoogleSignIn = async () => {
        try {
            setIsLoading(true);
            await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
            const signInResult = await GoogleSignin.signIn();            
            const idToken = signInResult?.idToken || signInResult?.data?.idToken;
            if (!idToken) {
                throw new Error(t("signin.error_signin_message"));
            }
            
            const googleCredential = auth.GoogleAuthProvider.credential(idToken);
            await auth().signInWithCredential(googleCredential);
    
            // Alert.alert(t("signin.alert_welcome_back"), t("signin.success_signin"));
            showMessage({
                message: t("signin.alert_welcome_back"),
                description:t("signin.success_signin"),
                type: "success",
              });
            onClose(); // Close the modal on success
        } catch (error) {
            console.error(t("signin.error_signin_message"), error);
            // Alert.alert(t("home.alert.error"), error?.message || t("signin.error_signin_message"));
            showMessage({
                message: t("home.alert.error"),
                description:error?.message || t("signin.error_signin_message"),
                type: "danger",
              });
        } finally {
            setIsLoading(false); // Reset loading state
        }
    };
    

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
                        onPress={handleGoogleSignIn}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <ActivityIndicator size="small" color="white" />
                        ) : (
                            <>
                                <Icon name="google" size={24} color="white" style={styles.googleIcon} />
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
        fontWeight: 'bold',
        textAlign: 'center',
    },
    input: {
        width: '100%',
        height: 50,
        borderColor: 'grey',
        borderWidth: 1,
        borderRadius: 5,
        paddingHorizontal: 10,
        marginBottom: 15,
    },
    primaryButton: {
        backgroundColor: '#007BFF',
        padding: 15,
        borderRadius: 5,
        alignItems: 'center',
        marginBottom: 10,
    },
    primaryButtonText: {
        color: 'white',
        fontWeight: 'bold',
    },
    secondaryButton: {
        padding: 10,
        alignItems: 'center',
        marginBottom: 10,
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
        height: 50,


    },
    applebUUTON: {
        height: 50,
        width: '100%',
        marginBottom: 10,
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
});

export default SignInDrawer;
