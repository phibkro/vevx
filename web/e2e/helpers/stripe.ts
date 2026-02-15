/**
 * Stripe test card numbers
 * https://stripe.com/docs/testing
 */

export const STRIPE_TEST_CARDS = {
  SUCCESS: '4242424242424242',
  DECLINED: '4000000000000002',
  REQUIRES_AUTH: '4000002500003155',
}

export const TEST_CARD_DETAILS = {
  number: STRIPE_TEST_CARDS.SUCCESS,
  expiry: '12/34',
  cvc: '123',
  zip: '12345',
}
