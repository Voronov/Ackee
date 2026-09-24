import { describeError, getClient } from '../../../clickhouse/client.js'
import config from '../../../utils/config.js'
import signale from '../../../utils/signale.js'

// 64-bit integers (count(), millisecond timestamps) would arrive as strings otherwise.
// Every version of a row shares its created month, so FINAL can deduplicate each
// partition on its own instead of merging all of them into one stream.
const settings = {
  output_format_json_quote_64bit_integers: 0,
  do_not_merge_across_partitions_select_final: 1,
}

// Apollo forwards the message of a thrown error to the client, and ClickHouse's
// messages quote the SQL and the column names; those belong in the log only
export default async (query, parameters) => {
  try {
    const result = await getClient().query({
      query,
      query_params: { database: config.clickhouseDatabase, ...parameters },
      format: 'JSONEachRow',
      clickhouse_settings: settings,
    })

    return await result.json()
  } catch (error) {
    signale.error(`ClickHouse report query failed: ${describeError(error)}`)
    throw new Error('Report query failed')
  }
}
