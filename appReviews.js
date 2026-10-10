// Omi's official download page and mobile app review service use these IDs.
// See https://www.omi.me/pages/download . Neither URL includes customer data.
const APP_STORE_REVIEW_URL = 'https://apps.apple.com/app/id6502156163?action=write-review';
const GOOGLE_PLAY_URL = 'https://play.google.com/store/apps/details?id=com.friend.ios';

function appReviewButtons() {
  // External links do not record support feedback or prove a review was submitted.
  return {
    type: 1,
    components: [
      { type: 2, style: 5, label: 'Review on App Store', url: APP_STORE_REVIEW_URL },
      { type: 2, style: 5, label: 'Open Google Play', url: GOOGLE_PLAY_URL },
    ],
  };
}

module.exports = { APP_STORE_REVIEW_URL, GOOGLE_PLAY_URL, appReviewButtons };
