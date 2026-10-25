import { describe, expect, it } from "vitest";
import type { Category } from "../types";
import { categorize } from "./index";

type Fixture = { name: string; from: string; subject?: string; headers?: Record<string, string>; known?: boolean; expect: Category };

const FIXTURES: Fixture[] = [
  { name: "Scoir automated notifications subdomain", from: "automated@notifications.scoir.com", subject: "A school viewed your profile", headers: { "feedback-id": "1:scoir:ses", "x-ses-outgoing": "2026.10.01-1.2.3.4" }, expect: "notifications" },
  { name: "Scoir subdomain only", from: "hello@notifications.scoir.com", expect: "notifications" },
  { name: "UGA admissions via Slate", from: "apply@uga.edu", subject: "Your application status", headers: { "x-mailer": "Slate by Technolutions", "return-path": "<bounce@slate.uga.edu>" }, expect: "notifications" },
  { name: "University admissions list", from: "admissions@mail.college.edu", subject: "Visit campus this fall", headers: { "list-unsubscribe": "<https://college.edu/u>", "x-mailer": "Salesforce Marketing Cloud" }, expect: "newsletters" },
  { name: "Cashnet receipt", from: "noreply@cashnet.com", subject: "Payment received - your receipt", headers: { "x-ses-outgoing": "1" }, expect: "notifications" },
  { name: "Cashnet receipt with unsubscribe", from: "payments@cashnet.com", subject: "Your receipt", headers: { "list-unsubscribe": "<mailto:u@cashnet.com>", "feedback-id": "a:b:c" }, expect: "notifications" },
  { name: "GitHub PR review", from: "notifications@github.com", subject: "Re: [repo] PR", headers: { "x-github-reason": "review_requested", "list-id": "<repo.github.com>", "list-unsubscribe": "<mailto:x>" }, expect: "notifications" },
  { name: "GitHub Dependabot", from: "noreply@github.com", subject: "Your Dependabot alerts", headers: { "list-unsubscribe": "<https://github.com/u>" }, expect: "notifications" },
  { name: "Linear issue", from: "notifications@linear.app", subject: "ENG-12 updated", headers: { "x-linear-team": "ENG", "list-unsubscribe": "<https://linear.app/u>" }, expect: "notifications" },
  { name: "Jira", from: "jira@acme.atlassian.net", subject: "[JIRA] (ABC-1) Fix", headers: { "list-id": "<jira.acme>" }, expect: "notifications" },
  { name: "Slack digest", from: "feedback@slack.com", subject: "You have new messages", headers: { "list-unsubscribe": "<https://slack.com/u>" }, expect: "notifications" },
  { name: "Stripe receipt", from: "receipts+acct_1@stripe.com", subject: "Your receipt from Acme", expect: "notifications" },
  { name: "Stripe from mail subdomain", from: "invoice+statements@mail.stripe.com", subject: "Invoice", expect: "notifications" },
  { name: "PayPal receipt", from: "service@paypal.com", subject: "Receipt for your payment to Acme", headers: { "list-unsubscribe": "<mailto:u@paypal.com>" }, expect: "notifications" },
  { name: "PayPal promo", from: "paypal@e.paypal.com", subject: "Earn 5% cash back this month", headers: { "list-unsubscribe": "<https://paypal.com/u>", "x-mailer": "ExactTarget" }, expect: "newsletters" },
  { name: "Amazon order shipped", from: "shipment-tracking@amazon.com", subject: "Your package has shipped", expect: "notifications" },
  { name: "Amazon deals", from: "store-news@amazon.com", subject: "Deals picked for you", headers: { "list-unsubscribe": "<https://amazon.com/u>" }, expect: "newsletters" },
  { name: "Uber trip receipt", from: "uber.us@uber.com", subject: "Your Tuesday evening trip with Uber", expect: "notifications" },
  { name: "DocuSign request", from: "dse@docusign.net", subject: "Please DocuSign this document", expect: "notifications" },
  { name: "Google security alert", from: "no-reply@accounts.google.com", subject: "Security alert", headers: { "feedback-id": "x:y" }, expect: "notifications" },
  { name: "Calendar invitation", from: "calendar-notification@google.com", subject: "Invitation: Sync @ Tue", expect: "notifications" },
  { name: "Password reset from small SaaS", from: "support@tinyapp.io", subject: "Reset your password", headers: { "x-mailgun-sid": "WyJ", "feedback-id": "1:tiny" }, expect: "notifications" },
  { name: "Verification code", from: "security@service.com", subject: "Your verification code", headers: { "x-sg-eid": "abc" }, expect: "notifications" },
  { name: "Substack newsletter", from: "writer@substack.com", subject: "Weekly thoughts", headers: { "list-id": "<writer.substack.com>", "list-unsubscribe": "<https://substack.com/u>" }, expect: "newsletters" },
  { name: "Mailchimp newsletter", from: "news@brand.com", subject: "October update", headers: { "list-unsubscribe": "<mailto:u@brand.com>", "x-mailer": "MailChimp Mailer" }, expect: "newsletters" },
  { name: "news subdomain", from: "digest@news.nytimes.com", expect: "newsletters" },
  { name: "Marketing from hubspot", from: "sales@company.com", subject: "See what is new", headers: { "list-unsubscribe": "<https://x>", "x-hs-cid": "1" }, expect: "newsletters" },
  { name: "Klaviyo promo", from: "shop@store.com", subject: "20% off", headers: { "list-unsubscribe": "<https://x>", "feedback-id": "k:1" }, expect: "newsletters" },
  { name: "Weak mail subdomain with ESP", from: "team@email.startup.com", subject: "Product update", headers: { "x-mailgun-sid": "x" }, expect: "notifications" },
  { name: "Mandrill transactional", from: "accounts@app.com", subject: "Welcome", headers: { "x-mc-user": "abc" }, expect: "notifications" },
  { name: "Precedence bulk only", from: "someone@corp.com", headers: { precedence: "bulk" }, expect: "notifications" },
  { name: "Auto-replied OOO", from: "jo@corp.com", subject: "Out of office", headers: { "auto-submitted": "auto-replied" }, expect: "notifications" },
  { name: "Outlook auto response suppress", from: "calendar@corp.com", headers: { "x-auto-response-suppress": "All" }, expect: "notifications" },
  { name: "Mailer daemon", from: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification", expect: "notifications" },
  { name: "Plain person Gmail", from: "carla@gmail.com", subject: "Dinner Friday?", headers: { "x-mailer": "iPhone Mail (22A)" }, expect: "people" },
  { name: "Person with Apple Mail", from: "dan@icloud.com", subject: "Re: notes", headers: { "x-mailer": "Apple Mail (2.3826)" }, expect: "people" },
  { name: "Professor at mail subdomain", from: "prof@mail.utexas.edu", subject: "Office hours", expect: "people" },
  { name: "Person at e subdomain", from: "sam@e.bigco.com", subject: "Quick question", expect: "people" },
  { name: "Support inbox human reply", from: "support@smallshop.com", subject: "Re: your question", expect: "people" },
  { name: "Info inbox human", from: "info@localclub.org", subject: "Meeting time", expect: "people" },
  { name: "Person saying receipt", from: "mom@gmail.com", subject: "Did you get the receipt?", expect: "people" },
  { name: "Recruiter personal", from: "recruiter@firm.com", subject: "Quick chat?", expect: "people" },
  { name: "Known contact with list headers", from: "friend@x.com", headers: { "list-id": "<club.x.com>" }, known: true, expect: "people" },
  { name: "Known contact noreply", from: "noreply@mybank.com", known: true, expect: "people" },
  { name: "Mailing list discussion", from: "alice@lists.org", subject: "[dev] proposal", headers: { "list-id": "<dev.lists.org>", "list-post": "<mailto:dev@lists.org>", precedence: "list" }, expect: "newsletters" },
  { name: "Missing sender", from: "", expect: "people" },
  { name: "Salesforce admissions mass mail", from: "admissions@university.edu", subject: "Congratulations", headers: { "x-sfdc-lk": "1" }, expect: "notifications" },
  { name: "Notify subdomain with unsubscribe", from: "no-reply@notify.app.com", subject: "Weekly summary", headers: { "list-unsubscribe": "<https://x>" }, expect: "notifications" },
];

describe("categorize corpus", () => {
  it("has at least 40 fixtures", () => expect(FIXTURES.length).toBeGreaterThanOrEqual(40));
  it.each(FIXTURES)("$name", (f) => {
    const got = categorize({ from: f.from ? { name: "", address: f.from } : null, headers: f.headers ?? {}, isKnownContact: f.known ?? false, subject: f.subject });
    expect(got).toBe(f.expect);
  });
});
