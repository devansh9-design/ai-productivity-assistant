# Launch checklist (Phase 2, Step 12)

What has to happen outside the code before other students use the app, and how to run their first week. Production: `https://ai-productivity-assistant-eta.vercel.app`.

## 1. Supabase: emails that actually reach students (blocker)

Supabase's built-in email sender only delivers to members of your Supabase team, and only a few emails an hour. Students wouldn't get their confirmation or password-reset emails. Set up your own sender:

1. Create a free [Resend](https://resend.com) account (3,000 emails a month). Add and verify a domain you own, or use a Gmail address with an [app password](https://myaccount.google.com/apppasswords) instead (about 500 emails a day).
2. Supabase dashboard → **Authentication → Emails → SMTP Settings** → turn on **Custom SMTP**:
   - Resend: host `smtp.resend.com`, port `465`, username `resend`, password = a Resend API key, sender e.g. `planner@yourdomain`.
   - Gmail: host `smtp.gmail.com`, port `465`, username = the Gmail address, password = the app password.
   - Sender name: `Personal Assistant`.
3. **Authentication → Rate Limits**: raise "emails sent per hour" to about 30.
4. **Authentication → URL Configuration**:
   - Site URL: `https://ai-productivity-assistant-eta.vercel.app`
   - Redirect URLs: add `https://ai-productivity-assistant-eta.vercel.app/auth/callback` (and `http://localhost:3000/auth/callback` for local testing).
5. **Authentication → Sign In / Providers → Email**: keep **Confirm email** on.
6. Test: sign up with a second email address you own, confirm it, sign out, then use **Forgot password?** and set a new password. Each link must be opened in the same browser that asked for it.

## 2. Vercel

- Add `AI_GLOBAL_REQUESTS_PER_DAY` to the production environment variables. Start at `500`, then set it a little under the daily request limit Google AI Studio shows for your Gemini key (the app falls back from Flash-Lite to Flash, so use the smaller of the two).
- Confirm `SUPABASE_SERVICE_ROLE_KEY` is set for production: Delete account needs it.

## 3. Google Calendar testers

The calendar scope needs Google's app verification before more than 100 people can connect. Until then:

1. Google Cloud console → **APIs & Services → OAuth consent screen → Audience** → keep publishing status **Testing**.
2. Under **Test users**, add the Google email of each student who asks (they email `shringidevansh@gmail.com`; Settings tells them how). Up to 100.
3. Students not on the list see Google's "Access blocked" page; the app explains this before they click Connect.

## 4. First week with 2–3 students

Pick students who haven't seen the app. Give them only the link. Don't help unless they're stuck for more than 5 minutes, and note where it happened.

| Day | They do | Check |
|---|---|---|
| 1 | Sign up, confirm email, onboarding (timetable, first goal), build a roadmap with AI or by hand | Sign-up to first day plan in under 5 minutes |
| 1–7 | Every morning: check-in → generate plan → confirm. Every evening: log → read the AI feedback | Each step under 2 minutes; plans never clash with classes; feedback matches the numbers |
| 3 | Use a replan button once (behind schedule or low energy) | The new plan stays inside their free time |
| 7 | Weekly review and next week's targets | Goal progress shows numbers and a chart |
| Any | Forgot password once; optional: connect Google Calendar | Reset email arrives; calendar connects or the beta message explains why not |

After the week, for each student:

- Did they ever need help, or a manual database edit? Either one fails the release criterion.
- Ask: what was confusing, what did they skip, would they keep using it?
- Check the `ai.rate_limited` events in the Vercel logs, and how many AI requests a day they used, to tune the limits.

## 5. Release criteria (student-planner-plan.md, section 5)

- [ ] Sign-up to first day plan in under 5 minutes
- [ ] Roadmaps down to weekly targets and daily tasks, by AI or by hand
- [ ] Daily loop every day, each step under 2 minutes
- [ ] Plans never clash with classes, exams or events, and fit the stated free time
- [ ] Progress per goal as numbers and a chart
- [ ] AI never changes data without confirmation; feedback matches logged numbers
- [ ] One student can never see another's data (RLS and database tests in CI)
- [ ] Within free tiers at the expected number of students
