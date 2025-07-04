import { Mixpanel } from "mixpanel-react-native";

const trackAutomaticEvents = true;
export const mixpanel = new Mixpanel("729cf710247965c0808ca89a314be3b5", trackAutomaticEvents);
mixpanel.init();

