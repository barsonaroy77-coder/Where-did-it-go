# Design Notes

- Base design: dashboard_positive_month and dashboard_negative_month_warning (one screen, two states).
- From the playful variant take only the category breakdown strip and the section title "Where Did It Go Today?".
- These HTML files are visual references only. Rebuild in React Native with the tokens in src/theme and existing components. Do not use Tailwind, web fonts, backdrop blur, or glass effects.
- Never show invented metrics (budget velocity, savings velocity, pace estimates, Boost, auto-deposit). Only computed values.
- Negative month message: "Spent X more than earned." Never use the words debt, deficit alert or safe zone.
- Goal progress = max(0, monthly saved) / target, bar clamped to 0..100%, actual saved shown even if negative or above target.
- Format money with the account currency and decimals, never a hardcoded "$" or ".00".
- Minimum text size 12px; support larger text sizes.
- Tabs: Home, Transactions, center Add button, Goals, Insights. The header profile circle opens Settings.
- Icons: a small SVG icon set via react-native-svg.
- No Personal/Business tabs, no account balances.
- Negative month: ONE message only ("Spent X more than earned.") under the hero amount. No second red banner, no "!!!" marks, no daily limit.
- Goal progress uses a 10-segment bar; a negative month shows 0% and the real (negative) saved amount.
