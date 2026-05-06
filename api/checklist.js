// /api/checklist — Public, token-authenticated endpoint for the customer-facing
// checklist page. The contact never logs in; the token in the URL is signed
// with SESSION_SECRET and encodes which case + which target stage they can
// work on. They can:
//   GET    → load their checklist
//   PATCH  → update an item's done state
//   POST?action=complete  → advance the case to the target stage and log activity
//
// Anything else (other case fields, contractor pool, partner directory) is off-limits.

import { verifyChecklistToken, mintChecklistToken } from './_lib/checklist-token.js';
import { listIntakes, updateIntake } from './_lib/store.js';
import { verifySession } from './_lib/auth.js';
import crypto from 'node:crypto';

// Re-export the journey definitions on the server side so we can return
// the right items for the target stage. Keep in sync with admin/index.html.
const JOURNEYS = {
  contractor: {
    label: 'Contractor / Builder',
    stages: [
      { id:'discovery', label:'Discovery' },
      { id:'scoping', label:'Scope & Quote' },
      { id:'permit-prep', label:'Permit Prep' },
      { id:'submitted', label:'Submitted' },
      { id:'approved', label:'Permit Issued' },
      { id:'in-progress', label:'In Progress' },
      { id:'inspection', label:'Inspections' },
      { id:'complete', label:'Complete' }
    ],
    checklist: [
      { id:'c1', text:'Confirmed property is in BNRI pilot zone (5th–15th, west of Irvine)' },
      { id:'c2', text:'Pulled Certificate of Survey (or confirmed not required)' },
      { id:'c3', text:'Identified plan basis: pre-approved BNRI plan # OR custom' },
      { id:'c4', text:'Calculated fees from 2026 schedule + ~65% BNRI waiver' },
      { id:'c5', text:'Checked setbacks vs Chapter 28 (variance/SUP needed?)' },
      { id:'c6', text:'Pulled property history from Beltrami Recorder' },
      { id:'c7', text:'SmartGov application drafted and reviewed with contractor' },
      { id:'c8', text:'Generated BNRI fee-waiver cover letter' },
      { id:'c9', text:'Pre-submittal call with city inspector (if non-standard)' },
      { id:'c10', text:'Permit submitted to City of Bemidji' },
      { id:'c11', text:'Permit issued (number captured below)' },
      { id:'c12', text:'Pre-construction kickoff with contractor' },
      { id:'c13', text:'Rough framing inspection passed' },
      { id:'c14', text:'Mechanical / electrical / plumbing rough inspections passed' },
      { id:'c15', text:'Insulation + drywall inspections passed' },
      { id:'c16', text:'Final inspection scheduled' },
      { id:'c17', text:'Final inspection passed — Certificate of Occupancy issued' },
      { id:'c18', text:'Project closed out' }
    ]
  },
  'homeowner-build': {
    label: 'Homeowner — building',
    stages: [
      { id:'discovery', label:'Discovery' }, { id:'eligibility', label:'Eligibility' },
      { id:'financing', label:'Financing' }, { id:'plans', label:'Plans + Permits' },
      { id:'in-progress', label:'Construction' }, { id:'inspection', label:'Inspections' },
      { id:'move-in', label:'Move-In' }, { id:'complete', label:'Complete' }
    ],
    checklist: [
      { id:'h1', text:'Confirmed pilot zone eligibility' },
      { id:'h2', text:'Ran ALICE income screen' },
      { id:'h3', text:'BNRI $10K grant application submitted' },
      { id:'h4', text:'10-year tax abatement enrollment opened' },
      { id:'h5', text:'BNRI 2–3% financing pre-approval obtained' },
      { id:'h6', text:'MN Housing Start Up / First-Generation pre-screen' },
      { id:'h7', text:'Plan selected (BNRI plan # OR custom design)' },
      { id:'h8', text:'Vetted contractor matched and contracted' },
      { id:'h9', text:'Permits filed via SmartGov + fee waiver letter attached' },
      { id:'h10', text:'Permits issued — number captured' },
      { id:'h11', text:'Construction kickoff' },
      { id:'h12', text:'Rough inspections passed' },
      { id:'h13', text:'Finish work complete' },
      { id:'h14', text:'Final inspection + Certificate of Occupancy' },
      { id:'h15', text:'Move-in scheduled' },
      { id:'h16', text:'Tax abatement confirmed on first roll' },
      { id:'h17', text:'Closeout: incentive stack reconciled' }
    ]
  },
  'homeowner-buy': {
    label: 'Homeowner — buying',
    stages: [
      { id:'discovery', label:'Discovery' }, { id:'pre-approval', label:'Pre-Approval' },
      { id:'inventory', label:'Inventory' }, { id:'offer', label:'Offer' },
      { id:'closing', label:'Closing' }, { id:'move-in', label:'Move-In' }, { id:'complete', label:'Complete' }
    ],
    checklist: [
      { id:'b1', text:'Confirmed buyer is targeting in-zone home' },
      { id:'b2', text:'MN Housing Start Up pre-screen' },
      { id:'b3', text:'MN Housing First-Generation pre-screen' },
      { id:'b4', text:'BNRI mortgage partner introduced' },
      { id:'b5', text:'Pre-approval letter received' },
      { id:'b6', text:'Inventory list shared (BNRI homes available)' },
      { id:'b7', text:'Property identified + showing scheduled' },
      { id:'b8', text:'Offer submitted' },
      { id:'b9', text:'Offer accepted — closing date set' },
      { id:'b10', text:'Inspection / appraisal complete' },
      { id:'b11', text:'Closing complete — keys handed over' },
      { id:'b12', text:'Tax abatement enrollment' },
      { id:'b13', text:'Move-in support packet sent' },
      { id:'b14', text:'Closeout: testimonial captured' }
    ]
  },
  'homeowner-relocate': {
    label: 'Homeowner — relocating',
    stages: [
      { id:'discovery', label:'Discovery' }, { id:'218-app', label:'218 Application' },
      { id:'housing', label:'Housing' }, { id:'move-in', label:'Move-In' }, { id:'complete', label:'Complete' }
    ],
    checklist: [
      { id:'r1', text:'Confirmed 95–100% remote work eligibility' },
      { id:'r2', text:'218 Relocate application started (within 30 days of move)' },
      { id:'r3', text:'Paul Bunyan Gigabit Internet ordered' },
      { id:'r4', text:'LaunchPad coworking membership activated' },
      { id:'r5', text:'In-zone housing identified' },
      { id:'r6', text:'$2,500 moving expense reimbursement submitted' },
      { id:'r7', text:'Networking welcome scheduled' },
      { id:'r8', text:'Closeout' }
    ]
  },
  'investor-private': {
    label: 'Private investor',
    stages: [
      { id:'discovery', label:'Discovery' }, { id:'thesis', label:'Thesis' },
      { id:'diligence', label:'Diligence' }, { id:'acquired', label:'Acquired' },
      { id:'reno', label:'Renovation' }, { id:'exit', label:'Exit' }, { id:'complete', label:'Complete' }
    ],
    checklist: [
      { id:'i1', text:'Investor classified: hold/flip/build-to-rent' },
      { id:'i2', text:'Target parcels pulled from Beltrami GIS' },
      { id:'i3', text:'ROI model run with BNRI stack' },
      { id:'i4', text:'Title / lien diligence on each parcel' },
      { id:'i5', text:'Acquisition closed — parcel list captured' },
      { id:'i6', text:'Vetted contractor matched' },
      { id:'i7', text:'Permits + fee waivers in place' },
      { id:'i8', text:'Renovation kickoff' },
      { id:'i9', text:'Final inspection + CO' },
      { id:'i10', text:'Listed for sale OR leased' },
      { id:'i11', text:'Closeout: ROI realized vs modeled' }
    ]
  },
  'investor-reit': {
    label: 'REIT / fund',
    stages: [
      { id:'discovery', label:'Discovery' }, { id:'thesis', label:'Thesis' },
      { id:'diligence', label:'Diligence' }, { id:'acquired', label:'Acquired' },
      { id:'reno', label:'Renovation' }, { id:'stabilized', label:'Stabilized' }, { id:'complete', label:'Complete' }
    ],
    checklist: [
      { id:'r1', text:'Acquisition criteria captured' },
      { id:'r2', text:'Multi-parcel target list assembled' },
      { id:'r3', text:'Bulk ROI model with BNRI stack' },
      { id:'r4', text:'City liaison meeting scheduled' },
      { id:'r5', text:'Title diligence batch run' },
      { id:'r6', text:'Acquisition closed across N parcels' },
      { id:'r7', text:'Vetted contractor pool engaged' },
      { id:'r8', text:'Permits + fee waivers obtained' },
      { id:'r9', text:'Renovation phases tracked' },
      { id:'r10', text:'Lease-up / sale execution per parcel' },
      { id:'r11', text:'Stabilized — ROI reported' },
      { id:'r12', text:'Closeout' }
    ]
  },
  partner: {
    label: 'Partner organization',
    stages: [
      { id:'intro', label:'Intro' }, { id:'mou', label:'MOU' },
      { id:'active', label:'Active' }, { id:'renewal', label:'Renewal' }
    ],
    checklist: [
      { id:'p1', text:'Partner type identified + named contact captured' },
      { id:'p2', text:'Mutual benefit conversation complete' },
      { id:'p3', text:'MOU drafted' },
      { id:'p4', text:'MOU signed by both parties' },
      { id:'p5', text:'Co-branded one-pager delivered' },
      { id:'p6', text:'Referral pipeline established' },
      { id:'p7', text:'Monthly check-in scheduled' },
      { id:'p8', text:'Quarterly progress report shared' },
      { id:'p9', text:'Annual MOU renewal' }
    ]
  },
  other: {
    label: 'Other',
    stages: [{ id:'discovery', label:'Discovery' }, { id:'qualified', label:'Qualified' }, { id:'closed', label:'Closed' }],
    checklist: [{ id:'o1', text:'First call complete' }, { id:'o2', text:'Need / persona identified' }, { id:'o3', text:'Routed to correct track' }]
  }
};
function journeyFor(persona){ return JOURNEYS[persona] || JOURNEYS.other; }

export default async function handler(req, res) {
  // Allow public GET / PATCH / POST with token
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  // Admin route: mint a new token (requires session)
  if (req.method === 'POST' && req.query.mint) {
    if (!verifySession(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { caseId, targetStage } = req.body || {};
    if (!caseId || !targetStage) return res.status(400).json({ error: 'caseId and targetStage required' });
    try {
      const token = mintChecklistToken(caseId, targetStage);
      return res.status(200).json({ ok: true, token });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message });
    }
  }

  // Token-secured public routes
  const token = req.query.token || (req.body && req.body.token);
  const decoded = verifyChecklistToken(token);
  if (!decoded) return res.status(401).json({ error: 'Invalid or expired link' });

  // Look up the case
  const items = await listIntakes(500);
  const it = items.find(x => x.id === decoded.caseId);
  if (!it) return res.status(404).json({ error: 'Case not found' });

  const j = journeyFor(it.persona);
  const targetStage = decoded.targetStage;
  const targetStageInfo = j.stages.find(s => s.id === targetStage);
  if (!targetStageInfo) return res.status(400).json({ error: 'Target stage not valid for this persona' });

  // Build the customer-visible journey state (subset of full journey)
  const stored = (it.journey || []).reduce((m,x) => (m[x.id]=x, m), {});
  const checklistItems = j.checklist.map(c => ({
    id: c.id,
    text: c.text,
    done: !!(stored[c.id] && stored[c.id].done),
    doneAt: stored[c.id]?.doneAt || null
  }));

  // GET: return the page data
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      contact: {
        name: it.name || 'You',
        persona: j.label,
        currentStage: it.stage || j.stages[0].id,
        targetStage: targetStage,
        targetStageLabel: targetStageInfo.label,
        address: it.address || ''
      },
      stages: j.stages,
      items: checklistItems,
      complete: it.stage === targetStage
    });
  }

  // PATCH: toggle a single item's done state
  if (req.method === 'PATCH') {
    const { itemId, done } = req.body || {};
    if (!itemId || typeof done !== 'boolean') return res.status(400).json({ error: 'itemId and done required' });
    const validIds = new Set(j.checklist.map(c => c.id));
    if (!validIds.has(itemId)) return res.status(400).json({ error: 'Unknown item' });

    const journey = it.journey || [];
    const idx = journey.findIndex(x => x.id === itemId);
    const entry = { id: itemId, done, doneAt: done ? new Date().toISOString() : undefined };
    if (idx >= 0) journey[idx] = entry; else journey.push(entry);

    const acts = it.activities || [];
    acts.push({
      id: 'a-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      at: new Date().toISOString(),
      type: 'event',
      text: (it.name || 'Contact') + (done ? ' checked off: ' : ' un-checked: ') + (j.checklist.find(c=>c.id===itemId)?.text || itemId)
    });
    if (acts.length > 200) acts.splice(0, acts.length - 200);

    await updateIntake(decoded.caseId, { journey, activities: acts });
    return res.status(200).json({ ok: true });
  }

  // POST?action=complete — advance the case to the target stage
  if (req.method === 'POST' && req.query.action === 'complete') {
    const acts = it.activities || [];
    acts.push({
      id: 'a-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      at: new Date().toISOString(),
      type: 'event',
      text: '✓ ' + (it.name || 'Contact') + ' submitted the ' + targetStageInfo.label + ' checklist online — case advanced to ' + targetStageInfo.label
    });
    if (acts.length > 200) acts.splice(0, acts.length - 200);

    await updateIntake(decoded.caseId, { stage: targetStage, status: 'qualified', activities: acts });
    return res.status(200).json({ ok: true, message: 'Stage advanced. The Concierge has been notified.' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
