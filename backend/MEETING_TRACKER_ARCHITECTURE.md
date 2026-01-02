# Meeting Tracker System Architecture

## 🎯 Vision
**Stop using janky third-party booking systems. Own the entire candidate-to-hire pipeline with built-in meeting scheduling, tracking, and follow-ups.**

## 📊 Core Features

### 1. Meeting Management
- **Schedule interviews** directly from candidate cards
- **Auto-sync** with Google Calendar / Calendly
- **Real-time availability** checking
- **One-click reschedule** with auto-notification
- **Meeting outcomes** logged to candidate pipeline
- **VA meeting prep** (auto-generate meeting notes template)

### 2. Smart Scheduling
- **Candidate availability** pulled from screening data
- **VA schedule** from hours log
- **Buffer time** between meetings (15 min default)
- **Priority queue** (high-fit candidates get earlier slots)
- **Timezone handling** (auto-detect from phone area code)
- **Auto-suggest** next 5 available slots

### 3. Meeting Types
- Phone Screening (15-30 min)
- Video Interview (30-60 min)
- Technical Assessment (45-90 min)
- Final Interview (60 min)
- Onboarding Meeting (30 min)

### 4. Integration Strategy

**Option A: Calendly API** (Recommended)
- ✅ Simple webhook integration
- ✅ Handles timezone, email confirmations, reminders
- ✅ No complex OAuth flow
- ✅ $12/month professional plan
- ❌ Dependency on external service

**Option B: Google Calendar API**
- ✅ Free
- ✅ Full control
- ✅ Direct integration with personal calendar
- ❌ Complex OAuth2 setup
- ❌ Must build reminders, confirmations ourselves

**Option C: Custom Meeting System** (Future)
- ✅ Complete ownership
- ✅ Whitelabel solution
- ❌ Massive dev time (video infra, notifications, etc.)
- ❌ Not worth it right now

**DECISION: Start with Calendly API, build abstraction layer so we can swap later**

## 🗄️ Database Schema

```sql
-- Meetings table
CREATE TABLE "Meetings" (
    "Meeting_ID" TEXT NOT NULL,
    "Candidate_ID" TEXT,  -- Can be NULL for internal meetings
    "Meeting_Type" TEXT NOT NULL,  -- SCREENING, INTERVIEW, TECHNICAL, FINAL, ONBOARDING
    "Scheduled_At" TIMESTAMP(3) NOT NULL,
    "Duration_Minutes" INTEGER NOT NULL DEFAULT 30,
    "Status" TEXT NOT NULL DEFAULT 'SCHEDULED',  -- SCHEDULED, COMPLETED, CANCELLED, NO_SHOW, RESCHEDULED
    "Meeting_URL" TEXT,  -- Zoom/Google Meet/Calendly link
    "Join_URL" TEXT,  -- Quick join link for VA
    "Calendar_Event_ID" TEXT,  -- Calendly event ID or Google Calendar event ID
    "Provider" TEXT NOT NULL DEFAULT 'CALENDLY',  -- CALENDLY, GOOGLE, MANUAL
    "Scheduled_By" TEXT NOT NULL,  -- VA name
    "Meeting_Notes" TEXT,  -- Pre-meeting prep notes
    "Outcome" TEXT,  -- HIRED, REJECTED, PENDING, CALLBACK
    "Outcome_Notes" TEXT,  -- Post-meeting summary
    "Reminder_Sent" BOOLEAN DEFAULT FALSE,
    "Confirmation_Sent" BOOLEAN DEFAULT FALSE,
    "Created_At" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Updated_At" TIMESTAMP(3) NOT NULL,
    "Completed_At" TIMESTAMP(3),
    "Cancelled_At" TIMESTAMP(3),
    "Cancelled_Reason" TEXT,

    CONSTRAINT "Meetings_pkey" PRIMARY KEY ("Meeting_ID")
);

-- Meeting attendees (for multi-person meetings)
CREATE TABLE "Meeting_Attendees" (
    "Attendee_ID" TEXT NOT NULL,
    "Meeting_ID" TEXT NOT NULL,
    "Attendee_Name" TEXT NOT NULL,
    "Attendee_Email" TEXT,
    "Role" TEXT,  -- CANDIDATE, INTERVIEWER, OBSERVER
    "RSVP_Status" TEXT DEFAULT 'PENDING',  -- PENDING, ACCEPTED, DECLINED

    CONSTRAINT "Meeting_Attendees_pkey" PRIMARY KEY ("Attendee_ID")
);

-- Calendar integration config (store API keys, webhook URLs)
CREATE TABLE "Calendar_Integrations" (
    "Config_ID" TEXT NOT NULL,
    "Provider" TEXT NOT NULL,  -- CALENDLY, GOOGLE
    "API_Key" TEXT,
    "Access_Token" TEXT,
    "Refresh_Token" TEXT,
    "Calendar_ID" TEXT,
    "Webhook_URL" TEXT,
    "Webhook_Secret" TEXT,
    "Active" BOOLEAN DEFAULT TRUE,
    "Created_At" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Updated_At" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Calendar_Integrations_pkey" PRIMARY KEY ("Config_ID")
);

-- Foreign keys
ALTER TABLE "Meetings" ADD CONSTRAINT "Meetings_Candidate_ID_fkey" 
    FOREIGN KEY ("Candidate_ID") REFERENCES "Candidate_Master"("Candidate_ID") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Meeting_Attendees" ADD CONSTRAINT "Meeting_Attendees_Meeting_ID_fkey" 
    FOREIGN KEY ("Meeting_ID") REFERENCES "Meetings"("Meeting_ID") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "Meetings_Candidate_ID_idx" ON "Meetings"("Candidate_ID");
CREATE INDEX "Meetings_Scheduled_At_idx" ON "Meetings"("Scheduled_At");
CREATE INDEX "Meetings_Status_idx" ON "Meetings"("Status");
CREATE INDEX "Meetings_Provider_idx" ON "Meetings"("Provider");
```

## 🔌 API Endpoints

### POST /api/v1?action=scheduleMeeting
**Create new meeting and sync to calendar**
```json
{
  "candidateId": "CAND_123",
  "meetingType": "INTERVIEW",
  "scheduledAt": "2025-12-06T14:00:00Z",
  "durationMinutes": 45,
  "notes": "Review technical background, ask about GHL experience"
}
```
**Response:**
```json
{
  "meetingId": "MTG_456",
  "joinUrl": "https://calendly.com/join/abc123",
  "calendarEventId": "evt_xyz",
  "confirmationSent": true
}
```

### GET /api/v1?action=upcomingMeetings
**Fetch upcoming meetings (next 7 days)**
```json
{
  "meetings": [
    {
      "meetingId": "MTG_456",
      "candidate": { "name": "John Doe", "phone": "555-1234" },
      "type": "INTERVIEW",
      "scheduledAt": "2025-12-06T14:00:00Z",
      "joinUrl": "...",
      "status": "SCHEDULED"
    }
  ],
  "count": 5
}
```

### GET /api/v1?action=meetingHistory
**Past meetings with outcomes**
```json
{
  "meetings": [
    {
      "meetingId": "MTG_123",
      "candidate": { "name": "Jane Smith" },
      "type": "SCREENING",
      "completedAt": "2025-12-03T10:30:00Z",
      "outcome": "CALLBACK",
      "outcomeNotes": "Strong phone presence, schedule full interview"
    }
  ]
}
```

### PATCH /api/v1?action=rescheduleMeeting
**Reschedule existing meeting**
```json
{
  "meetingId": "MTG_456",
  "newScheduledAt": "2025-12-07T15:00:00Z",
  "reason": "Candidate requested later time"
}
```

### POST /api/v1?action=completeMeeting
**Log meeting outcome**
```json
{
  "meetingId": "MTG_456",
  "outcome": "CALLBACK",
  "outcomeNotes": "Great culture fit, next step: technical assessment",
  "updateCandidateStage": "TECHNICAL_ASSESSMENT"
}
```

### POST /api/v1/webhooks/calendly
**Calendly webhook handler (invitee created, cancelled, rescheduled)**
```json
{
  "event": "invitee.created",
  "payload": { "event": { "uri": "...", "start_time": "..." } }
}
```

### GET /api/v1?action=availableSlots
**Get next 5 available meeting slots**
```json
{
  "candidateId": "CAND_123",
  "meetingType": "INTERVIEW",
  "durationMinutes": 45
}
```
**Response:**
```json
{
  "slots": [
    { "start": "2025-12-06T10:00:00Z", "end": "2025-12-06T10:45:00Z" },
    { "start": "2025-12-06T14:00:00Z", "end": "2025-12-06T14:45:00Z" },
    ...
  ]
}
```

## 🎨 UI Components

### Meetings Tab (New Tab in Dashboard)

```
┌────────────────────────────────────────────────────┐
│ 📅 MEETINGS                                        │
│ ┌─────────────────────────────────────────────┐   │
│ │ [Upcoming] [Past] [+ Schedule New Meeting]  │   │
│ └─────────────────────────────────────────────┘   │
│                                                    │
│ 🟢 Today - Dec 5, 2025                            │
│ ┌────────────────────────────────────────────┐    │
│ │ 10:00 AM - Phone Screening                 │    │
│ │ John Doe • 555-1234                        │    │
│ │ [Join Call] [Reschedule] [Cancel]          │    │
│ └────────────────────────────────────────────┘    │
│                                                    │
│ ┌────────────────────────────────────────────┐    │
│ │ 2:00 PM - Video Interview                  │    │
│ │ Jane Smith • jane@email.com                │    │
│ │ [Join Call] [Reschedule] [Cancel]          │    │
│ └────────────────────────────────────────────┘    │
│                                                    │
│ Tomorrow - Dec 6, 2025                            │
│ ┌────────────────────────────────────────────┐    │
│ │ 11:00 AM - Technical Assessment            │    │
│ │ Mike Johnson • 555-5678                    │    │
│ │ [View Prep Notes] [Reschedule]             │    │
│ └────────────────────────────────────────────┘    │
│                                                    │
│ 📊 This Week: 8 meetings scheduled                │
└────────────────────────────────────────────────────┘
```

### Schedule Meeting Modal

```
┌─────────────────────────────────────────┐
│ 📅 Schedule Interview                   │
├─────────────────────────────────────────┤
│ Candidate: [John Doe ▼]                │
│                                         │
│ Meeting Type: [● Phone Screening]      │
│               [○ Video Interview]       │
│               [○ Technical Assessment]  │
│                                         │
│ Suggested Times:                        │
│ [○] Tomorrow 10:00 AM (30 min)         │
│ [○] Tomorrow 2:00 PM (30 min)          │
│ [●] Dec 6, 11:00 AM (30 min)           │
│ [○] Dec 6, 3:00 PM (30 min)            │
│ [○] Custom time...                      │
│                                         │
│ Prep Notes:                             │
│ [Review GHL experience, ask about ___] │
│                                         │
│ [Cancel] [Schedule & Send Invite]      │
└─────────────────────────────────────────┘
```

### Post-Meeting Quick Log

```
┌─────────────────────────────────────────┐
│ ✅ Complete Meeting                     │
├─────────────────────────────────────────┤
│ John Doe - Phone Screening              │
│ Dec 5, 2025 10:00 AM                    │
│                                         │
│ Outcome:                                │
│ [○] Move to Interview                   │
│ [●] Callback Later                      │
│ [○] Reject                              │
│ [○] No Show                             │
│                                         │
│ Notes:                                  │
│ [Strong communication skills, good     │
│  GHL knowledge. Schedule full          │
│  interview next week.]                  │
│                                         │
│ Next Action:                            │
│ [Schedule Video Interview ▼]           │
│                                         │
│ [Cancel] [Save & Update Pipeline]      │
└─────────────────────────────────────────┘
```

## 🚀 Implementation Plan

### Phase 1: Database & Backend (Today)
1. Add Meetings, Meeting_Attendees, Calendar_Integrations tables to schema
2. Create migration SQL
3. Build API endpoints for CRUD operations
4. Add Calendly webhook handler
5. Test with manual meeting creation

### Phase 2: Calendly Integration (Tomorrow)
1. Set up Calendly API key
2. Build createCalendlyEvent() function
3. Test webhook flow (invitee created → update DB)
4. Add cancellation/reschedule sync

### Phase 3: Dashboard UI (Tomorrow)
1. Add "Meetings" tab to Dashboard.html
2. Build upcoming meetings list view
3. Add "Schedule Meeting" modal
4. Wire up to backend API
5. Test full flow: schedule → join → complete

### Phase 4: Smart Features (Next Week)
1. Auto-suggest available slots algorithm
2. Integrate candidate availability from screening
3. Add meeting prep notes generator (AI)
4. Build meeting analytics (conversion rates, no-show rates)

### Phase 5: Polish
1. Email/SMS confirmations (Twilio)
2. Meeting reminders (15 min before)
3. Calendar view (week/month grid)
4. Export to ICS file

## 🔐 Security & Config

**Environment Variables:**
```bash
CALENDLY_API_KEY=your_api_key_here
CALENDLY_WEBHOOK_SECRET=your_webhook_secret
GOOGLE_CALENDAR_CLIENT_ID=optional
GOOGLE_CALENDAR_CLIENT_SECRET=optional
```

**Webhook URL (Vercel):**
```
https://backend-1yqwwy2vm-tabari-ropers-projects-6f2e090b.vercel.app/api/v1/webhooks/calendly
```

## 📊 Success Metrics

- **Schedule Time**: <2 min to book interview from candidate card
- **No-Show Rate**: <10% (with automated reminders)
- **Reschedule Rate**: <15%
- **Pipeline Conversion**: Track screening → interview → hire conversion
- **VA Time Saved**: 30+ min/day (no manual calendar management)

---

**This is how we own the entire recruiting pipeline. No bullshit third-party dependencies we can't control.**
