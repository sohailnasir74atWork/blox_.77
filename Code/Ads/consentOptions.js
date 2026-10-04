// UMP "privacy options" entry point.
//
// Google's consent policy requires that users who were shown the EEA/UK/CH
// consent form can revisit their choice from inside the app (the form itself
// tells them to "look for a link or button in the app menu"). None of the
// apps offered one. The SDK tells us whether the current user needs the entry
// point (`privacyOptionsRequirementStatus === 'REQUIRED'`); outside those
// regions it is NOT_REQUIRED and the Settings row stays hidden, so nothing
// changes for the majority of users.
import { useEffect, useState } from 'react';
import { AdsConsent } from 'react-native-google-mobile-ads';

// True when the current user should see a "Privacy options" row. Reads the
// SDK's cached consent info, so it is cheap and never shows a form by itself.
export const usePrivacyOptionsRequired = () => {
  const [required, setRequired] = useState(false);
  useEffect(() => {
    let alive = true;
    AdsConsent.getConsentInfo()
      .then((info) => {
        if (alive) setRequired(info?.privacyOptionsRequirementStatus === 'REQUIRED');
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return required;
};

// Re-present the consent form so the user can change their choices. The SDK
// rewrites the TC string on close; the next ad requests pick it up on their
// own, so there is nothing for the caller to do afterwards.
export const showPrivacyOptionsForm = () =>
  AdsConsent.showPrivacyOptionsForm().catch(() => {});
