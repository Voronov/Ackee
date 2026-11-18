import { mergeTypeDefs } from '@graphql-tools/merge'
import { buildASTSchema, lexicographicSortSchema, printSchema } from 'graphql'
import {
  DateTimeTypeDefinition,
  PositiveFloatTypeDefinition,
  UnsignedIntTypeDefinition,
  URLTypeDefinition,
} from 'graphql-scalars'

import typeDefs from './index.js'

// Everything Apollo Server builds the schema from. The schema contract test reads the same list.
export const schemaTypeDefs = [
  UnsignedIntTypeDefinition,
  DateTimeTypeDefinition,
  PositiveFloatTypeDefinition,
  URLTypeDefinition,
  typeDefs,
]

export const schema = () => buildASTSchema(mergeTypeDefs(schemaTypeDefs))

// Sorted, so the snapshot does not change when type definitions move between files
export const printedSchema = () => printSchema(lexicographicSortSchema(schema()))
