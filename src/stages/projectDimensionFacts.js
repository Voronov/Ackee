export default (fields) => {
  // One record as a dimension rollup of a single record. A missing field becomes null, as it
  // does in the $group of a rollup.
  return {
    $project: {
      domainId: '$domainId',
      at: '$created',
      fields: Object.fromEntries(fields.map((field) => [field, { $ifNull: [`$${field}`, null] }])),
      count: { $literal: 1 },
    },
  }
}
