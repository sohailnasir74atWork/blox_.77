import { Mixpanel } from "mixpanel-react-native";

const trackAutomaticEvents = true;
export const mixpanel = new Mixpanel("529d4018a12ae5f0b563cd3aed0d116e", trackAutomaticEvents);
mixpanel.init();

