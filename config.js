// config.js — settings Sateki may change without touching code. PUBLIC FILE: never put secrets here.
// Prices, which services are online, payment links and page addresses.
export const CONFIG = {
  // 'live' since go-live (M5.3, 2026-11-17). 'test' = lead IDs start with USP-TEST and a TEST banner shows.
  // tools/serve.mjs always runs this laptop's copy in test mode with the testLink links.
  mode: 'live',

  // The tracker web app (Apps Script). Public address; anyone may post events to it.
  trackerUrl: 'https://script.google.com/macros/s/AKfycbycq5MW79UBouPy2pfFLfKi75Lvkff2_Q6DZKrGd4Oe8bH7t6AluNY7xJLuEHcnsk2f/exec',

  // Where Stripe sends customers after paying (set on each Stripe Payment Link in M3).
  afterPaymentUrl: 'https://www.uspathway.org/payment-confirmation',

  supportEmail: 'support@uspathway.org',

  // Sponsor income minimums by household size: 125% of the HHS poverty guidelines (USCIS Form I-864P),
  // 48 states + D.C., effective 2026-03-01. Update each spring from https://www.uscis.gov/i-864p
  sponsorIncomeLines: { h2: 27050, h3: 34150, h4: 41250, h5: 48350, h6: 55450, extra: 7100 },

  // online: false switches a service to the waitlist screen.
  // paymentLink: the live Stripe Payment Link for that service (made by Sateki 2026-11-17, M5.3).
  // testLink: the Stripe test-mode link, used only when the quiz runs on this laptop (tools/serve.mjs) and in tests.
  // Prices must match the price on the Stripe link. Confirmed by Sateki 2026-11-17.
  services: {
    aos:  { price: 1099, online: true, paymentLink: 'https://buy.stripe.com/bJebJ1fCJbe164edzvcs804', testLink: 'https://buy.stripe.com/test_bJebJ1fCJbe164edzvcs804' },
    n400: { price: 749,  online: true, paymentLink: 'https://buy.stripe.com/eVq5kD0HP5THakugLHcs803', testLink: 'https://buy.stripe.com/test_eVq5kD0HP5THakugLHcs803' },
    i90:  { price: 499,  online: true, paymentLink: 'https://buy.stripe.com/dRm00j8ah2Hv1NY1QNcs802', testLink: 'https://buy.stripe.com/test_dRm00j8ah2Hv1NY1QNcs802' },
    i751: { price: 449,  online: true, paymentLink: 'https://buy.stripe.com/28E28r0HP6XLgISdzvcs801', testLink: 'https://buy.stripe.com/test_28E28r0HP6XLgISdzvcs801' },
    k1:   { price: 998,  online: true, paymentLink: 'https://buy.stripe.com/eVqcN54Y52HveAKcvrcs800', testLink: 'https://buy.stripe.com/test_eVqcN54Y52HveAKcvrcs800' }
  }
};
