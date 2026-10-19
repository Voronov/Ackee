export default (sort) => {
  // $sort keeps no order between equal values: which of them survive $limit depends on
  // the query plan. `_id` is unique in every list we sort, so it settles the ties.
  return {
    $sort: {
      ...sort,
      _id: 1,
    },
  }
}
