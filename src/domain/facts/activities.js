// Routes documents, statements and records to the household's economic activities.
// Routing reads document type, issuer and the text on the page; nothing is keyed
// on a specific document id.

import { keyword, accountSuffixes } from './text.js';

// Properties are client configuration (what a preparer sets up on day one), matched
// against titles and printed text.
export const PROPERTIES = [
  { id: 'rental:fremont', name: 'Rental: 1450 Fremont Way, Sacramento', match: ['1450 fremont'] },
  { id: 'rental:condo', name: 'Rental (sold): 1200 Barton Hills Dr Unit 4C', match: ['1200 barton hills', 'unit 4c', 'condo'] },
  { id: 'home', name: 'Home: 7709 Barton Ridge Dr', match: ['7709 barton ridge', '(home'] },
];

const FIXED = {
  household: 'Household, identity and engagement',
  prior_year: 'Prior year (2024 return and prior preparer)',
  wages: 'Wages',
  stock_comp: 'Stock compensation (Corvane)',
  studio: 'Lindqvist Studio (Schedule C)',
  bank_accounts: 'Bank interest',
  crypto: 'Digital assets (Coinhaven)',
  foreign_account: 'Foreign account (Sparbanken Norrland)',
  ira: 'IRA and backdoor Roth',
  hsa: 'HSA',
  education: 'Education (Ada)',
  dependent_care: 'Dependent care (Theo)',
  charity: 'Charitable gifts',
  payments: 'Payments and estimates',
  notices: 'Agency notices',
  filing: 'Filing and e-file',
};

const BY_TYPE = {
  engagement_letter: 'household', consent_7216: 'household', identity_document: 'household', irs_ip_pin_notice: 'household',
  prior_year_return: 'prior_year', prior_workpaper: 'prior_year',
  'W-2': 'wages', paystub: 'wages',
  stock_plan_supplement: 'stock_comp', 3921: 'stock_comp', 3922: 'stock_comp',
  books_profit_loss: 'studio', books_transaction_detail: 'studio', books_report: 'studio', '1099-NEC': 'studio',
  '1099-K': 'studio', mileage_log: 'studio', client_note: 'studio', insurance_statement: 'studio', retirement_contribution: 'studio',
  '1099-DA': 'crypto', transaction_export: 'crypto',
  foreign_bank_statement: 'foreign_account',
  '1099-R': 'ira', 5498: 'ira', '1099-SA': 'hsa', '5498-SA': 'hsa',
  '1098-T': 'education', dependent_care_statement: 'dependent_care',
  donation_receipt: 'charity', '1098-C': 'charity',
  payment_confirmation: 'payments', irs_transcript: 'payments', irs_notice: 'notices',
};

const PROPERTY_TYPES = new Set(['rental_owner_statement', 'invoice', '1098', 'property_tax_bill', 'property_tax_receipt',
  'rental_ledger', 'closing_statement_seller', 'closing_statement_buyer', '1099-S', 'payoff_statement']);

const docText = (packet, doc) => [doc.title, ...packet.pages.filter((p) => p.doc_id === doc.id).map((p) => p.printed_content)]
  .join(' ').toLowerCase();

const matchProperty = (text) => PROPERTIES.find((p) => p.match.some((m) => text.includes(m)))?.id ?? null;

/** Returns { activities: Map(id -> {id, name}), docActivity: Map(docId -> activityId) }. */
export function routeDocuments(packet) {
  const activities = new Map(Object.entries(FIXED).map(([id, name]) => [id, { id, name }]));
  for (const p of PROPERTIES) activities.set(p.id, { id: p.id, name: p.name });
  const docActivity = new Map();
  const add = (id, name) => { if (!activities.has(id)) activities.set(id, { id, name }); return id; };

  // Brokerage accounts first, so standalone 1099-INTs for the same account can join them.
  const accountToActivity = new Map();
  for (const d of packet.documents.filter((x) => x.document_type === '1099-composite')) {
    const id = add(`investments:${keyword(d.issuer)}`, `Investments: ${d.issuer}`);
    docActivity.set(d.id, id);
    for (const a of accountSuffixes(docText(packet, d))) accountToActivity.set(a, id);
  }

  const pending = [];
  for (const d of packet.documents) {
    if (docActivity.has(d.id)) continue;
    const text = docText(packet, d);
    if (d.document_type === '1099-INT') {
      const viaAccount = accountSuffixes(text).map((a) => accountToActivity.get(a)).find(Boolean);
      docActivity.set(d.id, viaAccount ?? 'bank_accounts');
    } else if (d.document_type.startsWith('K-1')) {
      docActivity.set(d.id, add(`passthrough:${keyword(d.issuer)}`, `Pass-through: ${d.issuer}`));
    } else if (d.document_type === 'letter' && d.belongs_to === 'dependent:ada') {
      docActivity.set(d.id, 'education');
    } else if (PROPERTY_TYPES.has(d.document_type)) {
      const prop = matchProperty(text);
      if (prop) docActivity.set(d.id, prop);
      else if (d.document_type === 'invoice' && d.belongs_to === 'spouse') docActivity.set(d.id, 'studio');
      else pending.push(d); // e.g. a payoff statement that names only its lender
    } else {
      docActivity.set(d.id, BY_TYPE[d.document_type] ?? 'household');
    }
  }
  // Fallback: a property document with no address joins the property its issuer already serves.
  for (const d of pending) {
    const sibling = packet.documents.find((x) => x.id !== d.id && x.issuer === d.issuer && docActivity.has(x.id));
    docActivity.set(d.id, sibling ? docActivity.get(sibling.id) : 'household');
  }
  return { activities, docActivity, issuerWords: issuerWordIndex(packet, docActivity) };
}

const COMMON_WORDS = new Set(['inc', 'llc', 'llp', 'bank', 'services', 'service', 'savings', 'federal', 'credit', 'union',
  'company', 'group', 'county', 'internal', 'revenue', 'online', 'payments', 'securities', 'mortgage', 'title', 'plan',
  'administrator', 'equity', 'systems', 'family', 'various', 'handwritten', 'managed', 'self']);

/** Distinctive issuer words ("meridian", "woodworks", "brigid") -> the one activity they belong to. */
function issuerWordIndex(packet, docActivity) {
  const surnames = new Set(packet.raw.household.people.flatMap((p) => p.name.toLowerCase().split(/[\s-]+/)));
  const seen = new Map();
  for (const d of packet.documents) {
    for (const w of String(d.issuer).toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/)) {
      if (w.length < 5 || COMMON_WORDS.has(w) || surnames.has(w)) continue;
      if (!seen.has(w)) seen.set(w, new Set());
      seen.get(w).add(docActivity.get(d.id));
    }
  }
  return new Map([...seen].filter(([, acts]) => acts.size === 1).map(([w, acts]) => [w, [...acts][0]]));
}

const STATEMENT_TOPICS = [
  [/notice/i, 'notices'],
  [/crypto|coinhaven|digital asset/i, 'crypto'],
  [/\bsep\b|for the business/i, 'studio'], // "SEP, solo 401(k) or IRA for the business" is a studio question
  [/\bira\b|backdoor|roth/i, 'ira'],
  [/\bhsa\b|high-deductible/i, 'hsa'],
  [/health coverage|health insurance/i, 'studio'], // drives the self-employed health insurance deduction
  [/foreign|sweden|swedish/i, 'foreign_account'],
  [/business|contractor|\bsep\b|equipment|home office|vehicle|meals|mileage|1099-nec/i, 'studio'],
  [/fremont/i, 'rental:fremont'],
  [/condo/i, 'rental:condo'],
  [/rental/i, 'rental:fremont'],
  [/estimated|refund|payment/i, 'payments'],
  [/charit|parish|donat/i, 'charity'],
  [/child care|student|dependent/i, 'dependent_care'],
  [/stock|rsu|espp|option|investments/i, 'stock_comp'],
  [/w-2|employer|job/i, 'wages'],
  [/home|refinanc/i, 'home'],
];

const topicOf = (text) => STATEMENT_TOPICS.find(([re]) => re.test(text))?.[1];

/**
 * Activity for a client statement. In order: a document it names ("(D40)"), the
 * question's own topic, a distinctive issuer it mentions, then topic words anywhere.
 */
export function routeStatement(obs, { docActivity, issuerWords }) {
  const text = `${obs.label ?? ''} ${Array.isArray(obs.value) ? obs.value.join(' ') : obs.value ?? ''}`;
  const namedDoc = text.match(/\bD\d{2}\b/)?.[0];
  if (namedDoc && docActivity.has(namedDoc)) return docActivity.get(namedDoc);
  if (obs.id.startsWith('call-')) return 'studio'; // the one call note is a business walkthrough
  if (obs.id.startsWith('qa-')) {
    // A property named in the answer beats the question's generic wording ("rental or business property").
    const answerTopic = topicOf(String(obs.value));
    if (answerTopic?.startsWith('rental:')) return answerTopic;
    const hit = topicOf(obs.label ?? '');
    if (hit) return hit;
  }
  const words = text.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/);
  const viaIssuer = words.map((w) => issuerWords.get(w)).find(Boolean);
  return viaIssuer ?? topicOf(text) ?? 'household';
}
