import gql from 'graphql-tag'

export default gql`
  enum TrackingRuleType {
    """
    Clicks on elements that match the selector.
    """
    CLICK
    """
    Elements that match the selector and stayed at least half on screen for a second.
    """
    VISIBLE
    """
    Forms that match the selector and were sent. Never what was in them.
    """
    FORM
  }

  type TrackingRule {
    id: ID!
    type: TrackingRuleType!
    """
    A CSS selector, like #buy or .pricing.
    """
    selector: String!
    """
    The name the report shows for this rule.
    """
    label: String!
    """
    The pages the rule works on, like /product/* where * stands for anything. Empty for every page.
    """
    path: String!
  }

  type TrackingEvents {
    clicks: ID
    seen: ID
    forms: ID
    outbound: ID
    downloads: ID
    scroll: ID
    vitals: ID
  }

  """
  What the site collects besides page views, served to it by /t/<id>.js.
  """
  type DomainTracking {
    """
    A Google Tag Manager container the site loads, like GTM-ABC1234. Empty for none.
    """
    gtmId: String!
    outbound: Boolean!
    downloads: Boolean!
    downloadExtensions: [String!]!
    scroll: Boolean!
    vitals: Boolean!
    rules: [TrackingRule!]!
    """
    The Ackee events that hold what was collected, one per kind.
    """
    events: TrackingEvents!
  }

  input TrackingRuleInput {
    """
    Keeps the id of an existing rule. Omit for a new one.
    """
    id: ID
    type: TrackingRuleType!
    selector: String!
    label: String!
    path: String
  }

  input DomainTrackingInput {
    gtmId: String
    outbound: Boolean
    downloads: Boolean
    downloadExtensions: [String!]
    scroll: Boolean
    vitals: Boolean
    rules: [TrackingRuleInput!]
  }

  type UpdateDomainTrackingPayload {
    success: Boolean!
    payload: DomainTracking
  }

  extend type Domain {
    tracking: DomainTracking!
  }

  extend type Mutation {
    """
    Replaces what the site collects. Creates the events that hold it on first use.
    """
    updateDomainTracking(id: ID!, input: DomainTrackingInput!): UpdateDomainTrackingPayload!
  }
`
