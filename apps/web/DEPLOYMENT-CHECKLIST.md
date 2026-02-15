# Production Deployment Checklist

Complete this checklist before going live with the AI Code Auditor dashboard.

## Pre-Deployment

### Database
- [ ] Production PostgreSQL database provisioned
- [ ] Database URL added to environment variables
- [ ] Database connection tested
- [ ] SSL enabled for database connections
- [ ] Backup strategy configured

### Environment Variables
- [ ] All `.env` variables set in production
- [ ] `NEXT_PUBLIC_APP_URL` set to production domain
- [ ] `DATABASE_URL` points to production database
- [ ] Clerk production keys configured
- [ ] Stripe production keys configured (not test mode!)
- [ ] Webhook secrets match production endpoints

### Clerk Setup
- [ ] Production Clerk application created
- [ ] Email provider configured (production emails)
- [ ] Webhook endpoint pointing to production URL
- [ ] Webhook events verified: user.created, user.updated, user.deleted
- [ ] Custom branding configured
- [ ] Password policy reviewed
- [ ] Social login providers configured (if needed)

### Stripe Setup
- [ ] Stripe account activated (moved from test to live mode)
- [ ] Products created in live mode (Pro, Team)
- [ ] Prices set correctly ($29, $149)
- [ ] Production webhook endpoint configured
- [ ] Webhook events subscribed
- [ ] Customer portal settings configured
- [ ] Email receipts enabled
- [ ] Tax collection configured (if applicable)

### Security
- [ ] Environment variables secured (not in git)
- [ ] API key generation uses cryptographically secure random
- [ ] Database credentials rotated
- [ ] HTTPS enforced (no HTTP)
- [ ] CORS configured correctly
- [ ] Rate limiting implemented (if needed)
- [ ] Input validation on all API endpoints
- [ ] SQL injection prevention (Prisma handles this)
- [ ] XSS prevention (Next.js handles most)

### Testing
- [ ] Sign up flow tested
- [ ] Sign in flow tested
- [ ] Team creation tested
- [ ] API key creation tested
- [ ] CLI audit sync tested
- [ ] Dashboard displays audits correctly
- [ ] Upgrade to Pro tested
- [ ] Upgrade to Team tested
- [ ] Billing portal tested
- [ ] Webhook handlers tested (Stripe test mode)
- [ ] Mobile responsiveness checked

## Deployment

### Build
- [ ] `npm run build` succeeds with no errors
- [ ] No TypeScript errors
- [ ] No ESLint warnings (critical ones)
- [ ] Bundle size acceptable

### Vercel Deployment
- [ ] Project connected to GitHub
- [ ] Environment variables added to Vercel
- [ ] Custom domain configured
- [ ] SSL certificate auto-provisioned
- [ ] Build settings correct (Next.js detected)
- [ ] Production deployment successful
- [ ] Preview deployments working

### Post-Deployment
- [ ] Production URL accessible
- [ ] Sign up works end-to-end
- [ ] Clerk webhooks receiving events
- [ ] Database records being created
- [ ] API endpoint accessible from CLI
- [ ] Stripe checkout working
- [ ] Stripe webhooks receiving events
- [ ] Email notifications working

## Monitoring

### Alerts
- [ ] Error tracking setup (Sentry, LogRocket, etc.)
- [ ] Uptime monitoring (UptimeRobot, Pingdom, etc.)
- [ ] Database monitoring
- [ ] Stripe webhook monitoring
- [ ] Email alerts for critical errors

### Analytics
- [ ] User sign-ups tracked
- [ ] Subscription events tracked
- [ ] API usage tracked
- [ ] Audit count tracked
- [ ] Error rates monitored

### Logs
- [ ] Application logs accessible
- [ ] Database query logs (if needed)
- [ ] Webhook event logs
- [ ] Error logs centralized

## Documentation

### User Docs
- [ ] Getting started guide
- [ ] CLI integration instructions
- [ ] Team setup instructions
- [ ] Billing/pricing page
- [ ] FAQ/troubleshooting
- [ ] Support contact information

### Developer Docs
- [ ] Setup instructions (README)
- [ ] API documentation
- [ ] Webhook documentation
- [ ] Database schema documented
- [ ] Environment variables documented

## Launch

### Communication
- [ ] Beta users notified
- [ ] Launch announcement prepared
- [ ] Social media posts ready
- [ ] Email campaign ready (if applicable)
- [ ] Support channel ready (Discord, email, etc.)

### Pricing
- [ ] Free tier limits finalized
- [ ] Pro pricing confirmed ($29/mo)
- [ ] Team pricing confirmed ($149/mo)
- [ ] Annual pricing (if offered)
- [ ] Refund policy documented
- [ ] Terms of service finalized
- [ ] Privacy policy finalized

### Support
- [ ] Support email configured (support@...)
- [ ] Support ticket system (if needed)
- [ ] Knowledge base (if needed)
- [ ] First responder assigned

## Post-Launch

### Week 1
- [ ] Monitor error rates daily
- [ ] Check webhook success rates
- [ ] Review user feedback
- [ ] Fix critical bugs
- [ ] Respond to support requests

### Month 1
- [ ] Review conversion rates (free → paid)
- [ ] Analyze churn (if any)
- [ ] Gather user feedback
- [ ] Plan iteration 1 features
- [ ] Optimize database queries (if needed)
- [ ] Review and optimize costs

## Rollback Plan

If something goes wrong:

1. [ ] Rollback checklist documented
2. [ ] Previous deployment tagged in git
3. [ ] Database backup recent (< 1 hour old)
4. [ ] Rollback procedure tested

### Rollback Steps
1. Revert to previous Vercel deployment
2. Check database schema compatibility
3. Verify webhooks still working
4. Test critical user flows
5. Monitor for 30 minutes
6. Communicate with users if needed

## Emergency Contacts

- [ ] Database provider support
- [ ] Vercel support
- [ ] Clerk support
- [ ] Stripe support
- [ ] Your phone number for urgent issues

---

## Notes

Use this space for deployment-specific notes, credentials locations, etc.

