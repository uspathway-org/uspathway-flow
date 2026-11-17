// config.js — settings Sateki may change without touching code. PUBLIC FILE: never put secrets here.
// Prices, which services are online, payment links and page addresses.
export const CONFIG = {
  // 'test' = lead IDs start with USP-TEST and a TEST banner shows. Switch to 'live' at go-live (M5.3).
  mode: 'test',

  // The tracker web app (Apps Script). Public address; anyone may post events to it.
  trackerUrl: 'https://script.google.com/macros/s/AKfycbycq5MW79UBouPy2pfFLfKi75Lvkff2_Q6DZKrGd4Oe8bH7t6AluNY7xJLuEHcnsk2f/exec',

  // Where Stripe sends customers after paying (set on each Stripe Payment Link in M3).
  afterPaymentUrl: 'https://www.uspathway.org/payment-confirmation',

  supportEmail: 'support@uspathway.org',

  // SP1 income screen cutoff in US dollars [confirm]. Simple screen, not the legal poverty-guideline test.
  sponsorIncomeScreen: 25000,

  // online: false switches a service to the waitlist screen.
  // paymentLink: the Stripe Payment Link for that service. Placeholders until M3.
  services: {
    aos:  { price: 1099, online: true, paymentLink: 'https://buy.stripe.com/test_REPLACE_IN_M3_aos' },
    n400: { price: 749,  online: true, paymentLink: 'https://buy.stripe.com/test_REPLACE_IN_M3_n400' },
    i90:  { price: 499,  online: true, paymentLink: 'https://buy.stripe.com/test_REPLACE_IN_M3_i90' },   // price [confirm]
    i751: { price: 449,  online: true, paymentLink: 'https://buy.stripe.com/test_REPLACE_IN_M3_i751' },  // price [confirm]
    k1:   { price: 998,  online: true, paymentLink: 'https://buy.stripe.com/test_REPLACE_IN_M3_k1' }     // price [confirm]
  }
};
