import type { loadCapture } from '../../billing-capture/loadCapture'
import {
  dayPlusMonths,
  fromLocalDayString,
  toLocalDayString,
} from '../localDayString'
import type { NormalizedProviderBilling } from '../normalizedProviderBilling'
import { usdToAud } from '../usdToAud'
import { fetchOauthUsage } from './fetchOauthUsage'

type Capture = Awaited<ReturnType<typeof loadCapture>>

/** Australian GST on Anthropic prepaid credits: tranche amounts are
 * tax-exclusive, payments are GST-inclusive (40 AUD grant, 44 AUD payment). */
const ANTHROPIC_GST_MULTIPLIER = 1.1
/** A prepaid grant lands up to a minute before the invoice that paid for it. */
const GRANT_TO_INVOICE_WINDOW_MS = 60_000

const defaultDeps = { fetchOauthUsage }

type Invoice = Capture['anthropic']['invoices']['invoices'][number]
type Tranche = Capture['anthropic']['prepaidCredits']['tranches'][number]

function invoiceAmountAud(invoice: Invoice): number {
  return invoice.currency.toLowerCase() === 'aud'
    ? invoice.total / 100
    : usdToAud(invoice.total / 100)
}

/** Classifies an invoice as a prepaid-credit purchase when a tranche grant
 * immediately precedes it and the grant plus GST matches the invoice total —
 * invoice/grant/tax evidence, not a recurring-amount heuristic. */
function isCreditPurchaseInvoice(params: {
  invoice: Invoice
  tranches: Tranche[]
}): boolean {
  const invoiceTs = params.invoice.created_ts * 1000
  const invoiceAud = params.invoice.total / 100
  return params.tranches.some((tranche) => {
    const grantedTs = Date.parse(tranche.granted_at)
    const grantedAud = tranche.granted_amount_minor_units / 100
    return (
      grantedTs <= invoiceTs &&
      invoiceTs - grantedTs <= GRANT_TO_INVOICE_WINDOW_MS &&
      Math.abs(grantedAud * ANTHROPIC_GST_MULTIPLIER - invoiceAud) <= 0.01
    )
  })
}

export async function normalizeAnthropicBilling(
  params: { capture: Capture['anthropic'] },
  deps = defaultDeps
): Promise<NormalizedProviderBilling> {
  const tranches = params.capture.prepaidCredits.tranches
  for (const tranche of tranches) {
    if (tranche.currency.toLowerCase() !== 'aud') {
      throw new Error(
        'non-AUD Anthropic prepaid tranches have no verified GST treatment'
      )
    }
  }

  const paidInvoices = params.capture.invoices.invoices.filter(
    (invoice) => invoice.display_status_key === 'paid' && invoice.total > 0
  )
  const planInvoices = paidInvoices.filter(
    (invoice) => !isCreditPurchaseInvoice({ invoice, tranches })
  )
  const latestPlanInvoice = planInvoices.toSorted(
    (a, b) => b.created_ts - a.created_ts
  )[0]
  if (!latestPlanInvoice) {
    throw new Error(
      'no paid Anthropic plan invoice found — cannot resolve the billing cycle'
    )
  }

  const cycleStart = toLocalDayString(
    new Date(latestPlanInvoice.created_ts * 1000)
  )
  const cycleEnd = dayPlusMonths({ day: cycleStart, months: 1 })
  const cycleStartMs = fromLocalDayString(cycleStart).getTime()
  const cycleEndMs = fromLocalDayString(cycleEnd).getTime()

  let planPaymentAud = 0
  let creditPurchasesAud = 0
  for (const invoice of paidInvoices) {
    const invoiceTs = invoice.created_ts * 1000
    if (!(invoiceTs >= cycleStartMs && invoiceTs < cycleEndMs)) continue
    if (isCreditPurchaseInvoice({ invoice, tranches })) {
      creditPurchasesAud += invoiceAmountAud(invoice)
    } else {
      planPaymentAud += invoiceAmountAud(invoice)
    }
  }
  if (planPaymentAud <= 0) {
    throw new Error(
      `no paid Anthropic plan payment in cycle ${cycleStart}..${cycleEnd}`
    )
  }

  let creditsConsumedAud = 0
  for (const tranche of tranches) {
    const grantedTs = Date.parse(tranche.granted_at)
    if (!(grantedTs >= cycleStartMs && grantedTs < cycleEndMs)) continue
    const depletedAud =
      (tranche.granted_amount_minor_units -
        tranche.remaining_amount_minor_units) /
      100
    creditsConsumedAud += depletedAud * ANTHROPIC_GST_MULTIPLIER
  }

  const usage = await deps.fetchOauthUsage()

  return {
    provider: 'anthropic',
    cycleStart,
    cycleEnd,
    planPaymentAud,
    creditPurchasesAud,
    utilization: {
      basis: 'elapsed',
      fraction: Math.min(1, Math.max(0, usage.seven_day.utilization / 100)),
    },
    creditsConsumedAud,
    modelShares: null,
  }
}

normalizeAnthropicBilling.defaultDeps = defaultDeps
