import { defineRoute } from '../fetchWithPagination'
import { billingTablesBody, extractBillingTables } from './extractBillingTables'

export const NEURALWATT_ROUTES = {
  billing: defineRoute({
    path: '/dashboard/billing',
    file: 'neuralwatt-billing',
    schema: billingTablesBody,
    // decodes and validates: extractBillingTables runs billingTablesBody.parse
    // on the normalized rows before they reach the stage dir
    parse: async (body) => extractBillingTables({ html: body }),
  }),
}
