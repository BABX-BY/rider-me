// The delivery business day follows the shop timezone, not the database server timezone.
export const BUSINESS_DATE_SQL = "(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date";
