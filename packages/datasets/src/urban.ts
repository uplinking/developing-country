import type { IndicatorDatasetDefinition } from './presets'

/** Urban-development tables reviewed against their original publications. */
export const URBAN_DATASETS: readonly IndicatorDatasetDefinition[] = [
  {
    id: 'local-government-services',
    title: 'Local government services',
    label: 'Local services',
    themeIds: ['REGI', 'GOVE', 'TRAN'],
    description: 'Road lengths and public facilities reported by municipal councils, urban councils and Pradeshiya Sabhas.',
    sourceIds: ['dcs-pocketbook-2026'],
    vintage: '2024, published in the Statistical Pocket Book 2026',
    note: {
      dek: 'Road lengths and public facilities reported by municipal councils, urban councils and Pradeshiya Sabhas.',
      question: 'What roads and public facilities do local authorities report?',
      contains: 'National totals by council type for vehicular roads, dispensaries, cemeteries, parks and playgrounds, and libraries in 2024. DCS compiled these figures from returns submitted by local government institutions.',
      use: 'Compare the facilities reported by each council type. The main chart shows libraries; a second chart compares road length in kilometres.',
      limit: 'These are national aggregates for one year. They do not locate individual facilities, measure service quality or show access per resident. The published total overlaps the three council categories and must not be added to them. Counts of facilities and kilometres of roads have different units.',
    },
    presets: [
      {
        id: 'libraries', title: 'Local government libraries',
        description: 'Libraries reported by council type in 2024. The national total is excluded from the comparison.',
        query: { fields: ['council_type', 'value'], where: [{ field: 'service', op: 'eq', value: 'Libraries' }, { field: 'council_type', op: 'in', value: ['Municipal', 'Urban', 'Pradeshiya Sabha'] }], order_by: [{ field: 'value', direction: 'desc' }], limit: 200 },
        chart: { family: 'ranking', dimension: { field: 'council_type', label: 'Council type' }, measure: { field: 'value', label: 'Libraries', unit: 'facilities' }, orientation: 'horizontal' },
      },
      {
        id: 'roads', title: 'Local government roads',
        description: 'Vehicular road length reported by council type in 2024, in kilometres.',
        query: { fields: ['council_type', 'value'], where: [{ field: 'service', op: 'eq', value: 'Vehicular roads' }, { field: 'council_type', op: 'in', value: ['Municipal', 'Urban', 'Pradeshiya Sabha'] }], order_by: [{ field: 'value', direction: 'desc' }], limit: 200 },
        chart: { family: 'ranking', dimension: { field: 'council_type', label: 'Council type' }, measure: { field: 'value', label: 'Road length', unit: 'km' }, orientation: 'horizontal' },
      },
    ],
  },
{
  "id": "telecom-services",
  "title": "Telecom subscriptions and telephone density",
  "label": "Telecom services",
  "themeIds": [
    "TECH"
  ],
  "description": "Fixed and mobile telephone services, internet subscriptions and telephone density in Sri Lanka.",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "vintage": "2022–2025, Statistical Pocket Book 2026",
  "note": {
    "dek": "Fixed and mobile telephone services, internet subscriptions and telephone density in Sri Lanka.",
    "question": "How have telephone and internet subscriptions changed?",
    "contains": "Annual national figures for 2022–2025 compiled by DCS from the Telecommunications Regulatory Commission. Measures cover wireline and wireless local-loop services, cellular mobile subscriptions, telephone density with and without data-only services, fixed internet subscribers and mobile broadband subscriptions.",
    "use": "Track mobile broadband subscriptions or fixed internet subscribers over time. Telephone density uses services per 100 people, while the other measures count lines, subscriptions or subscribers.",
    "limit": "Subscriptions are not unique people or households, and overlapping service categories must not be added together. The source flags mobile broadband subscriptions as rebased without specifying the rebasing date or method. Wireless local-loop counts include data-only and LTE services from 2021 onward. National totals do not show coverage, connection speed or geographic access. The 2022 data-inclusive density is printed as a dash and is retained without an exact numeric value."
  },
  "presets": [
    {
      "id": "mobile-broadband",
      "title": "Mobile broadband subscriptions",
      "description": "National mobile broadband subscriptions, 2022–2025. TRCSL flags these counts as rebased.",
      "query": {
        "fields": [
          "year",
          "value"
        ],
        "where": [
          {
            "field": "service",
            "op": "eq",
            "value": "Mobile broadband"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Mobile broadband",
          "unit": "subscriptions"
        }
      }
    },
    {
      "id": "fixed-internet",
      "title": "Fixed internet subscribers",
      "description": "National fixed internet and email subscribers, 2022–2025.",
      "query": {
        "fields": [
          "year",
          "value"
        ],
        "where": [
          {
            "field": "service",
            "op": "eq",
            "value": "Fixed internet and email"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Fixed internet and email",
          "unit": "subscribers"
        }
      }
    }
  ]
},
{
  "id": "building-material-prices",
  "title": "Building material retail prices",
  "label": "Building material prices",
  "themeIds": [
    "REGI",
    "ECON"
  ],
  "description": "Annual all-island retail prices for cement, bricks, sand, lime, roof and ceiling products, and paint.",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "vintage": "2021–2025, Statistical Pocket Book 2026",
  "note": {
    "dek": "Annual all-island retail prices for selected building materials.",
    "question": "How have the retail prices of building materials changed?",
    "contains": "Prices in Sri Lankan rupees for ten selected building materials, 2021–2025. Each product retains its quoted sale unit. DCS identifies the cement as Holcim Super Cement and the plain ceiling sheet price as the average of Rino and Mascon.",
    "use": "Compare the cement price per 50 kg bag or clay brick price per 1,000 over time. Other products can be selected with their own quoted units.",
    "limit": "These are nominal national retail prices for selected products, not a construction cost index, project quotation or district price survey. Product specifications and package sizes differ. The unit for sand is printed as “Cube” without a volume definition. Its 2025 price contains two decimal points and has no numeric value here. An extra final full stop in the 2025 boiled-lime price was removed after visual review; the original token and review note are retained."
  },
  "presets": [
    {
      "id": "cement",
      "title": "Cement retail price",
      "description": "All-island retail price in Sri Lankan rupees per 50 kg bag of Holcim Super Cement, 2021–2025.",
      "query": {
        "fields": [
          "year",
          "value"
        ],
        "where": [
          {
            "field": "material",
            "op": "eq",
            "value": "Cement"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Cement price",
          "unit": "LKR per 50 kg bag"
        }
      }
    },
    {
      "id": "bricks",
      "title": "Clay brick retail price",
      "description": "All-island retail price in Sri Lankan rupees per 1,000 clay bricks, 2021–2025.",
      "query": {
        "fields": [
          "year",
          "value"
        ],
        "where": [
          {
            "field": "material",
            "op": "eq",
            "value": "Clay bricks"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Clay brick price",
          "unit": "LKR per 1,000"
        }
      }
    }
  ]
},
{
  "id": "local-government-revenue",
  "title": "Local government revenue",
  "label": "Local revenue",
  "themeIds": [
    "REGI",
    "GOVE",
    "ECON"
  ],
  "description": "Provisional local-authority revenue by income category, with provincial detail for Pradeshiya Sabhas.",
  "sourceIds": [
    "dcs-local-revenue-mc-uc-2024",
    "dcs-local-revenue-ps-2024"
  ],
  "vintage": "2024 provisional; Statistical Abstract 2025",
  "note": {
    "dek": "Local-authority revenue, including taxes, service charges, grants and capital receipts.",
    "question": "Where do local authorities obtain their revenue?",
    "contains": "Provisional 2024 figures in thousands of Sri Lankan rupees. Municipal and urban councils are reported as national aggregates. Pradeshiya Sabhas are reported for each province and as a national total. Tables distinguish recurrent and capital revenue, their components, and total receipts.",
    "use": "Compare the total receipts of the three council types or compare Pradeshiya Sabha receipts across provinces. Select individual revenue categories to examine taxes, fees or grants.",
    "limit": "This is one provisional year, with no individual-council accounts. Provincial figures cover Pradeshiya Sabhas only. Published totals, subtotals and components overlap and must not be added together. Capital receipts include loans and asset sales, so total receipts are not a measure of recurring fiscal capacity. Missing entries remain blank, and published totals may differ slightly from the sums of their rounded components."
  },
  "presets": [
    {
      "id": "council-revenue",
      "title": "Revenue by council type",
      "description": "National total receipts by council type, 2024 provisional, in thousands of Sri Lankan rupees.",
      "query": {
        "fields": [
          "council_type",
          "value"
        ],
        "where": [
          {
            "field": "geography",
            "op": "eq",
            "value": "Sri Lanka"
          },
          {
            "field": "revenue_category",
            "op": "eq",
            "value": "Total revenue"
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "council_type",
          "label": "Council type"
        },
        "measure": {
          "field": "value",
          "label": "Revenue",
          "unit": "LKR thousand"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "ps-province",
      "title": "Pradeshiya Sabha revenue by province",
      "description": "Pradeshiya Sabha total receipts by province, 2024 provisional, in thousands of Sri Lankan rupees.",
      "query": {
        "fields": [
          "geography",
          "value"
        ],
        "where": [
          {
            "field": "council_type",
            "op": "eq",
            "value": "Pradeshiya Sabha"
          },
          {
            "field": "geography",
            "op": "in",
            "value": [
              "Western",
              "Central",
              "Southern",
              "Northern",
              "Eastern",
              "North Western",
              "North Central",
              "Uva",
              "Sabaragamuwa"
            ]
          },
          {
            "field": "revenue_category",
            "op": "eq",
            "value": "Total revenue"
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "geography",
          "label": "Province"
        },
        "measure": {
          "field": "value",
          "label": "Revenue",
          "unit": "LKR thousand"
        },
        "orientation": "horizontal"
      }
    }
  ]
},
{
  "id": "local-government-expenditure",
  "title": "Local government expenditure",
  "label": "Local expenditure",
  "themeIds": [
    "REGI",
    "GOVE",
    "ECON"
  ],
  "description": "Provisional local-authority expenditure by spending category, with provincial detail for Pradeshiya Sabhas.",
  "sourceIds": [
    "dcs-local-expenditure-mc-uc-2024",
    "dcs-local-expenditure-ps-2024"
  ],
  "vintage": "2024 provisional; Statistical Abstract 2025",
  "note": {
    "dek": "Local-authority spending on staff, supplies, maintenance, services and capital outlays.",
    "question": "How do local authorities spend their funds?",
    "contains": "Provisional 2024 expenditure in thousands of Sri Lankan rupees. Municipal and urban councils are national aggregates; Pradeshiya Sabhas are shown by province and as a national total. Categories cover recurrent spending, capital spending and their components.",
    "use": "Compare total expenditure by council type or Pradeshiya Sabha capital expenditure across provinces. The detailed categories identify staff costs, repairs and maintenance, supplies, services, grants, pensions, investment outlays and loan repayments.",
    "limit": "Figures cover one provisional year and do not identify individual councils or the outcomes of spending. Provincial figures cover Pradeshiya Sabhas only. Totals and components overlap; small differences in their sums are retained. Capital expenditure includes loan repayments and therefore is broader than physical investment. In table 15.7, the final column is mislabelled as capital expenditure; its I+II formula and values identify it as total expenditure. This interpretation is recorded on every affected observation."
  },
  "presets": [
    {
      "id": "council-spending",
      "title": "Expenditure by council type",
      "description": "National total expenditure by council type, 2024 provisional, in thousands of Sri Lankan rupees.",
      "query": {
        "fields": [
          "council_type",
          "value"
        ],
        "where": [
          {
            "field": "geography",
            "op": "eq",
            "value": "Sri Lanka"
          },
          {
            "field": "expenditure_category",
            "op": "eq",
            "value": "Total expenditure"
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "council_type",
          "label": "Council type"
        },
        "measure": {
          "field": "value",
          "label": "Expenditure",
          "unit": "LKR thousand"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "ps-capital-province",
      "title": "Pradeshiya Sabha capital expenditure",
      "description": "Capital expenditure by province, including loan repayments, 2024 provisional, in thousands of Sri Lankan rupees.",
      "query": {
        "fields": [
          "geography",
          "value"
        ],
        "where": [
          {
            "field": "council_type",
            "op": "eq",
            "value": "Pradeshiya Sabha"
          },
          {
            "field": "geography",
            "op": "in",
            "value": [
              "Western",
              "Central",
              "Southern",
              "Northern",
              "Eastern",
              "North Western",
              "North Central",
              "Uva",
              "Sabaragamuwa"
            ]
          },
          {
            "field": "expenditure_category",
            "op": "eq",
            "value": "Total capital expenditure"
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "geography",
          "label": "Province"
        },
        "measure": {
          "field": "value",
          "label": "Expenditure",
          "unit": "LKR thousand"
        },
        "orientation": "horizontal"
      }
    }
  ]
},
{
  "id": "government-health-services",
  "title": "Government health services",
  "label": "Health services",
  "themeIds": [
    "HEAL",
    "GOVE"
  ],
  "description": "Government hospitals, beds, health staff, patient visits and health expenditure in Sri Lanka.",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "vintage": "2016–2025; 2024 revised and 2025 provisional, Statistical Pocket Book 2026",
  "note": {
    "dek": "Government hospitals, beds, health staff, patient visits and health expenditure.",
    "question": "How have government health capacity and spending changed?",
    "contains": "Annual national Ministry of Health and Mass Media figures for 2016–2025, compiled in the DCS Pocket Book. Measures include hospitals, beds, central dispensaries and primary medical care units, doctors, assistant or registered medical practitioners, nurses, outpatient and inpatient visits, and expenditure. The source also provides beds, doctors, hospitals and expenditure per 100,000 people. Figures for 2024 are revised; 2025 is provisional.",
    "use": "Track government hospital beds or nominal health expenditure over time. Use the separately published population-standardised measures to compare capacity relative to population.",
    "limit": "Government services do not cover the entire private health sector. Hospital and bed counts exclude central dispensaries and primary medical care units except units with maternity homes; these outpatient units have a separate count. Doctor figures cover all grades in the Ministry of Health. Patient figures count visits, not unique people, and are reported in thousands. Expenditure includes capital expenditure, grants, rebates and contributions; the amounts are nominal and do not adjust for inflation. National figures do not measure geographic access, staffing distribution or quality."
  },
  "presets": [
    {
      "id": "hospital-beds",
      "title": "Government hospital beds",
      "description": "Government hospital beds, 2016–2025. The 2024 figure is revised and 2025 provisional.",
      "query": {
        "fields": [
          "year",
          "value",
          "observation_status"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Hospital beds"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Hospital beds",
          "unit": "beds"
        }
      }
    },
    {
      "id": "health-expenditure",
      "title": "Government health expenditure",
      "description": "Annual nominal expenditure in millions of Sri Lankan rupees, including capital spending and grants. The 2025 figure is provisional.",
      "query": {
        "fields": [
          "year",
          "value",
          "observation_status"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Health expenditure"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Health expenditure",
          "unit": "LKR million"
        }
      }
    },
    {
      "id": "doctor-density",
      "title": "Government doctors per 100,000 people",
      "description": "Published national doctor density, 2016–2025. The 2024 figure is revised and 2025 provisional.",
      "query": {
        "fields": [
          "year",
          "value",
          "observation_status"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Doctors per 100,000 people"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Doctors per 100,000 people",
          "unit": "doctors per 100,000 people"
        }
      }
    }
  ]
},
{
  "id": "school-resources",
  "title": "School enrolment and resources",
  "label": "School resources",
  "themeIds": [
    "EDUC",
    "SOCI"
  ],
  "description": "Schools, teachers, pupils, pupil–teacher ratios and new admissions by school type.",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "vintage": "2022–2025, Statistical Pocket Book 2026",
  "note": {
    "dek": "Schools, teachers, pupils, pupil–teacher ratios and new government-school admissions.",
    "question": "How are school enrolment and teaching resources changing?",
    "contains": "Annual national Ministry of Education figures for 2022–2025, compiled by DCS. The school types are government schools, government-approved private schools, special schools and Piriven. The table includes category counts, totals, published pupil–teacher ratios and new government-school admissions.",
    "use": "Track the total pupil count over time or compare published pupil–teacher ratios across the four school types. School and teacher counts provide context for enrolment changes.",
    "limit": "The totals cover the four reported categories, including Piriven; they are not a count of every education provider. These national aggregates do not describe individual schools, classroom crowding, teacher subjects or district inequalities. Pupil–teacher ratios are published whole-number ratios, not class sizes. New admissions cover government schools only. Totals overlap their school-type components."
  },
  "presets": [
    {
      "id": "pupils",
      "title": "School pupils",
      "description": "Total pupils in the four reported school categories, 2022–2025.",
      "query": {
        "fields": [
          "year",
          "value"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Pupils"
          },
          {
            "field": "school_type",
            "op": "eq",
            "value": "All reported types"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Pupils",
          "unit": "people"
        }
      }
    },
    {
      "id": "pupil-teacher-ratio",
      "title": "Pupil–teacher ratio by school type",
      "description": "Published national ratios, 2022–2025. These whole-number ratios do not measure class size.",
      "query": {
        "fields": [
          "year",
          "value",
          "school_type"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Pupil–teacher ratio"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "school_type",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Pupil–teacher ratio",
          "unit": "pupils per teacher"
        },
        "series": {
          "field": "school_type",
          "label": "School type"
        },
        "showLegend": true
      }
    }
  ]
},
{
  "id": "informal-sector-employment-district",
  "title": "Informal-sector employment by district",
  "label": "Informal-sector employment",
  "themeIds": [
    "SOCI",
    "ECON",
    "REGI"
  ],
  "description": "The share of non-agricultural employment in informal-sector enterprises, by district.",
  "sourceIds": [
    "dcs-lfs-2025-annual"
  ],
  "vintage": "2025; Labour Force Survey Annual Report 2025, published September 2026",
  "note": {
    "dek": "District shares of non-agricultural employment in informal-sector enterprises.",
    "question": "How much non-agricultural employment is in the informal sector in each district?",
    "contains": "The 2025 Labour Force Survey annual report provides one national percentage and 25 district percentages for employed people aged 15 and over. Non-agricultural employment covers industry and services. The source classifies enterprises using registration, formal accounts and the number of regular employees. The report says 2025 estimates were reweighted using the 2024 Census population estimates.",
    "use": "Compare the informal-sector share of non-agricultural employment across districts. The national percentage is kept separately and excluded from the district ranking.",
    "limit": "This is enterprise-sector classification, which differs from whether an individual job is informal or lacks social protection. These percentages are shares within each district, not each district’s share of all informal workers; they cannot be added or averaged to obtain the national rate. Agricultural employment is excluded. Survey estimates have sampling uncertainty. Only 2025 is included, so the data does not establish a trend. Original district spellings are retained beside standardised labels."
  },
  "presets": [
    {
      "id": "district-share",
      "title": "Informal-sector share of non-agricultural employment",
      "description": "Share of non-agricultural employment in informal-sector enterprises by district, 2025. The national figure is excluded.",
      "query": {
        "fields": [
          "geography",
          "value"
        ],
        "where": [
          {
            "field": "geography_type",
            "op": "eq",
            "value": "district"
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "geography",
          "label": "District"
        },
        "measure": {
          "field": "value",
          "label": "Informal-sector share",
          "unit": "% of non-agricultural employment"
        },
        "orientation": "horizontal"
      }
    }
  ]
},
{
  "id": "transport-passengers-freight",
  "title": "Transport passengers and freight",
  "label": "Passengers and freight",
  "themeIds": [
    "TRAN",
    "ECON"
  ],
  "description": "Annual passenger and freight volumes for rail, bus services and airlines.",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "vintage": "2022–2025, Statistical Pocket Book 2026",
  "note": {
    "dek": "Rail, bus and airline passenger volumes, plus rail and air freight.",
    "question": "How have passenger and freight volumes changed across transport services?",
    "contains": "National annual figures for 2022–2025 compiled by DCS from the Sri Lanka Transport Board, National Transport Commission, Department of Railways and Civil Aviation Authority. Passenger series cover railways, omnibus services, SLTB, the national airline and foreign airlines. Freight series cover railways and the two airline categories. Passenger figures are in thousands of persons; freight is in thousands of metric tonnes. The 2024 SLTB passenger figure is revised.",
    "use": "Track railway passenger volume and railway freight separately. Airline and bus series can be selected with their original units and category definitions.",
    "limit": "Volumes do not identify routes, passenger origins, travel distances, service frequency or unique travellers. The source labels a bus category “Ominibus Services” without defining its overlap with SLTB; the two bus series must not be added as if they were a verified total. Passenger counts and freight tonnage have different units, and air traffic should not be interpreted as resident mobility."
  },
  "presets": [
    {
      "id": "rail-passengers",
      "title": "Railway passengers",
      "description": "Annual railway passenger volume in thousands of persons, 2022–2025.",
      "query": {
        "fields": [
          "year",
          "value",
          "observation_status"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Passengers"
          },
          {
            "field": "operator",
            "op": "eq",
            "value": "Railway"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Passengers",
          "unit": "thousand persons"
        }
      }
    },
    {
      "id": "rail-freight",
      "title": "Railway freight",
      "description": "Annual railway freight volume in thousands of metric tonnes, 2022–2025.",
      "query": {
        "fields": [
          "year",
          "value",
          "observation_status"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Freight"
          },
          {
            "field": "operator",
            "op": "eq",
            "value": "Railway"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Freight",
          "unit": "thousand metric tonnes"
        }
      }
    },
    {
      "id": "sltb-passengers",
      "title": "Sri Lanka Transport Board passengers",
      "description": "SLTB passenger volume in thousands of persons. The 2024 figure is revised.",
      "query": {
        "fields": [
          "year",
          "value",
          "observation_status"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Passengers"
          },
          {
            "field": "operator",
            "op": "eq",
            "value": "Sri Lanka Transport Board"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Passengers",
          "unit": "thousand persons"
        }
      }
    }
  ]
},
{
  "id": "energy-supply-consumption",
  "title": "Energy supply and consumption",
  "label": "Energy supply and use",
  "themeIds": [
    "ENER",
    "ECON",
    "ENVI"
  ],
  "description": "Annual electricity generation and sales, petroleum imports and processing, and LPG production.",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "vintage": "2021–2025, Statistical Pocket Book 2026",
  "note": {
    "dek": "Annual electricity generation and sales, petroleum imports and processing, and LPG production.",
    "question": "How have electricity use and fuel supply changed?",
    "contains": "National annual Ceylon Electricity Board and Ceylon Petroleum Corporation figures for 2021–2025, compiled by DCS. Electricity measures cover net generation by provider and technology and sales by customer category. Fuel measures cover imported refined petroleum, processed crude oil and LPG production.",
    "use": "Track total electricity sales, compare domestic, industrial and commercial electricity sales, or select the petroleum and LPG series with their own units. Electricity is in GWh; petroleum quantities are in thousands of metric tonnes and LPG in metric tonnes.",
    "limit": "Generation totals, provider subtotals and technology categories overlap. Electricity generation and sales differ in coverage and are not a direct estimate of grid losses. LECO is a separately reported electricity sales category. Other renewable energy groups wind, biomass, solar, dendro and municipal waste; the source says rooftop solar has been included in generation since 2018. Rounded components can differ slightly from totals. Fuel mass cannot be added to electricity output without energy conversion factors. These annual figures use a different reporting scope from the platform’s recent grid-generation feed."
  },
  "presets": [
    {
      "id": "electricity-sales",
      "title": "Electricity sales",
      "description": "Annual total electricity sales in GWh, 2021–2025.",
      "query": {
        "fields": [
          "year",
          "value"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Electricity sales"
          },
          {
            "field": "category",
            "op": "eq",
            "value": "Total"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Electricity sales",
          "unit": "GWh"
        }
      }
    },
    {
      "id": "electricity-sales-sector",
      "title": "Electricity sales by customer category",
      "description": "Domestic and religious, industrial and commercial sales in GWh, 2021–2025. LECO and street lighting remain available separately.",
      "query": {
        "fields": [
          "year",
          "value",
          "category"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Electricity sales"
          },
          {
            "field": "category",
            "op": "in",
            "value": [
              "Domestic and religious",
              "Industrial",
              "Commercial"
            ]
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "category",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Electricity sales",
          "unit": "GWh"
        },
        "series": {
          "field": "category",
          "label": "Customer category"
        },
        "showLegend": true
      }
    },
    {
      "id": "crude-processed",
      "title": "Crude oil processed",
      "description": "Annual crude oil processed in thousands of metric tonnes, 2021–2025.",
      "query": {
        "fields": [
          "year",
          "value"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Crude oil processed"
          },
          {
            "field": "category",
            "op": "eq",
            "value": "Total"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Crude oil processed",
          "unit": "thousand metric tonnes"
        }
      }
    }
  ]
},
{
  "id": "minimum-wage-indices",
  "title": "Minimum wage indices",
  "label": "Minimum wage indices",
  "themeIds": [
    "ECON",
    "SOCI"
  ],
  "description": "Minimum wage indices for agriculture, industry and commerce, services, and all classes combined.",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "vintage": "2018–2025; base 1978=100, Statistical Pocket Book 2026",
  "note": {
    "dek": "Minimum wage indices by class of worker, with 1978 as the base year.",
    "question": "How have minimum wage indices changed across worker classes?",
    "contains": "Annual Department of Labour indices for 2018–2025, compiled by DCS at base 1978=100. The classes are agriculture, industry and commerce, services, and all classes combined.",
    "use": "Track the combined minimum wage index or compare the three worker classes on the published index base.",
    "limit": "These are index numbers, not wage amounts in rupees, average earnings or the share of workers paid a minimum wage. They do not measure inflation-adjusted purchasing power or compliance with wage rules. The combined index overlaps the worker-class indices and cannot be added to them. The Pocket Book does not provide the weights or detailed occupational coverage."
  },
  "presets": [
    {
      "id": "combined",
      "title": "Combined minimum wage index",
      "description": "Annual index for all worker classes combined, 2018–2025. Base: 1978=100.",
      "query": {
        "fields": [
          "year",
          "value"
        ],
        "where": [
          {
            "field": "worker_class",
            "op": "eq",
            "value": "All combined"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Minimum wage index",
          "unit": "1978=100"
        }
      }
    },
    {
      "id": "worker-classes",
      "title": "Minimum wage indices by worker class",
      "description": "Agriculture, industry and commerce, and services, 2018–2025. Base: 1978=100.",
      "query": {
        "fields": [
          "year",
          "value",
          "worker_class"
        ],
        "where": [
          {
            "field": "worker_class",
            "op": "in",
            "value": [
              "Agriculture",
              "Industry and commerce",
              "Services"
            ]
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "worker_class",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Minimum wage index",
          "unit": "1978=100"
        },
        "series": {
          "field": "worker_class",
          "label": "Worker class"
        },
        "showLegend": true
      }
    }
  ]
},
{
  "id": "fisheries-production-capacity",
  "title": "Fisheries production and capacity",
  "label": "Fisheries",
  "themeIds": [
    "AGRI",
    "ECON"
  ],
  "description": "Fish production by fishing subsector, operating boats and active fishers.",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "vintage": "Fish production 2018–2025; fleet and fishers 2022–2025; 2025 provisional",
  "note": {
    "dek": "Fish production, operating fishing boats and active fishers.",
    "question": "How have fish output and fishing capacity changed?",
    "contains": "Ministry of Fisheries national figures compiled by DCS. Annual output for 2018–2025 is split into coastal, offshore or deep-sea, and inland or aquaculture production. Fleet and active-fisher counts cover 2022–2025, with marine and inland categories. All 2025 figures are provisional.",
    "use": "Track total fish production, total operating boats, or the number of active fishers. Subsector and fleet-type records allow more detailed comparisons.",
    "limit": "Output is in metric tonnes, fleet size in boats and fishers in people; these measures cannot be added together. Published totals overlap their components. Active-fisher counts do not measure hours worked or fishing income. National aggregates do not describe landing sites, districts, fish stocks or sustainability. The source’s 2023 total for active fishers exceeds the sum of its marine and inland counts by 280 people; all three published figures are retained."
  },
  "presets": [
    {
      "id": "fish-output",
      "title": "Fish production",
      "description": "National total fish production in metric tonnes, 2018–2025. The 2025 figure is provisional.",
      "query": {
        "fields": [
          "year",
          "value",
          "observation_status"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Fish production"
          },
          {
            "field": "category",
            "op": "eq",
            "value": "Total"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Fish production",
          "unit": "metric tonnes"
        }
      }
    },
    {
      "id": "fleet",
      "title": "Operating fishing boats",
      "description": "Total operating fishing fleet, 2022–2025. The 2025 figure is provisional.",
      "query": {
        "fields": [
          "year",
          "value",
          "observation_status"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Fishing fleet"
          },
          {
            "field": "category",
            "op": "eq",
            "value": "Total"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Fishing fleet",
          "unit": "boats"
        }
      }
    },
    {
      "id": "fishers",
      "title": "Active fishers",
      "description": "National active-fisher count, 2022–2025. The 2025 figure is provisional.",
      "query": {
        "fields": [
          "year",
          "value",
          "observation_status"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Active fishers"
          },
          {
            "field": "category",
            "op": "eq",
            "value": "Total"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Active fishers",
          "unit": "people"
        }
      }
    }
  ]
},
{
  "id": "crop-area-production",
  "title": "Crop area and production",
  "label": "Crop area and output",
  "themeIds": [
    "AGRI",
    "ECON"
  ],
  "description": "Annual cultivated extent and production for principal crops and food crops.",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "vintage": "2021–2025; selected revised and estimated cells, Statistical Pocket Book 2026",
  "note": {
    "dek": "Annual crop areas and output for 19 principal and food crops.",
    "question": "How have crop area and output changed?",
    "contains": "National figures for 2021–2025 compiled by DCS with the Tea Board, Rubber Development Department and plantation ministries. Nineteen crops have reported extent and production. Areas are in hectares. Output is in metric tonnes except coconut, which is in millions of nuts. Source revision markers are retained; the 2025 rubber extent is identified as an estimate.",
    "use": "Track maize production or cultivated area, and compare tea output over time. Select one crop and measure before comparing years.",
    "limit": "Extent does not have a single agronomic meaning across all crops. The paddy extent is asweddumized land under major schemes, minor schemes and rainfed cultivation, rather than the seasonal sown or harvested area. Crop areas may overlap through multiple cropping and must not be summed as unique land. Do not calculate yields by dividing these output figures by incompatible area definitions. Coconut output uses a different unit from other crops. The estimated rubber area may change."
  },
  "presets": [
    {
      "id": "maize-output",
      "title": "Maize production",
      "description": "Annual maize production in metric tonnes, 2021–2025.",
      "query": {
        "fields": [
          "year",
          "value",
          "observation_status"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Production"
          },
          {
            "field": "crop",
            "op": "eq",
            "value": "Maize"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Production",
          "unit": "metric tonnes"
        }
      }
    },
    {
      "id": "maize-area",
      "title": "Maize cultivated area",
      "description": "Published maize extent in hectares, 2021–2025.",
      "query": {
        "fields": [
          "year",
          "value",
          "observation_status"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Area"
          },
          {
            "field": "crop",
            "op": "eq",
            "value": "Maize"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Area",
          "unit": "hectares"
        }
      }
    },
    {
      "id": "tea-output",
      "title": "Tea production",
      "description": "Annual tea production in metric tonnes, 2021–2025. The 2024 figure is revised.",
      "query": {
        "fields": [
          "year",
          "value",
          "observation_status"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Production"
          },
          {
            "field": "crop",
            "op": "eq",
            "value": "Tea"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Production",
          "unit": "metric tonnes"
        }
      }
    }
  ]
},
{
  "id": "crop-production-costs",
  "title": "Crop production costs",
  "label": "Crop production costs",
  "themeIds": [
    "AGRI",
    "ECON"
  ],
  "description": "Annual production costs for tea, rubber and coconut in their published product units.",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "vintage": "Financial years 2015/16–2024/25, Statistical Pocket Book 2026",
  "note": {
    "dek": "Production costs for tea, rubber and coconut by financial year.",
    "question": "How have the costs of producing principal crops changed?",
    "contains": "DCS production-cost figures for ten financial years from 2015/16 to 2024/25. Tea and rubber are quoted in Sri Lankan rupees per kilogram; coconut is quoted per 1,000 nuts. Financial-year labels are retained.",
    "use": "Compare tea and rubber cost trends on their per-kilogram basis, or view coconut production costs with its separate unit.",
    "limit": "These are nominal production costs, not market prices, earnings or profits. Coconut uses a different product unit. The summary table does not provide cost-component breakdowns, district variation, sample details or inflation adjustment. A financial year must not be presented as a calendar-year observation."
  },
  "presets": [
    {
      "id": "tea-rubber",
      "title": "Tea and rubber production costs",
      "description": "Nominal production costs in Sri Lankan rupees per kilogram, financial years 2015/16–2024/25.",
      "query": {
        "fields": [
          "financial_year",
          "value",
          "crop"
        ],
        "where": [
          {
            "field": "crop",
            "op": "in",
            "value": [
              "Tea",
              "Rubber"
            ]
          }
        ],
        "order_by": [
          {
            "field": "end_year",
            "direction": "asc"
          },
          {
            "field": "crop",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "financial_year",
          "label": "Financial year"
        },
        "measure": {
          "field": "value",
          "label": "Production cost",
          "unit": "LKR per kg"
        },
        "series": {
          "field": "crop",
          "label": "Crop"
        },
        "showLegend": true
      }
    },
    {
      "id": "coconut",
      "title": "Coconut production cost",
      "description": "Nominal production cost in Sri Lankan rupees per 1,000 nuts, financial years 2015/16–2024/25.",
      "query": {
        "fields": [
          "financial_year",
          "value"
        ],
        "where": [
          {
            "field": "crop",
            "op": "eq",
            "value": "Coconut"
          }
        ],
        "order_by": [
          {
            "field": "end_year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "financial_year",
          "label": "Financial year"
        },
        "measure": {
          "field": "value",
          "label": "Production cost",
          "unit": "LKR per 1,000 nuts"
        }
      }
    }
  ]
},
{
  "id": "livestock-production",
  "title": "Livestock, milk and eggs",
  "label": "Livestock and animal products",
  "themeIds": [
    "AGRI",
    "ECON"
  ],
  "description": "National livestock populations and milk and egg production.",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "vintage": "2020–2025, Statistical Pocket Book 2026",
  "note": {
    "dek": "Livestock populations and milk and egg production in Sri Lanka.",
    "question": "How have livestock numbers and animal-product output changed?",
    "contains": "Annual DCS national figures for 2020–2025. Animal groups are cattle, buffaloes, goats and sheep combined, pigs and poultry, all in thousands of animals. Milk production is in thousands of litres; eggs are in millions.",
    "use": "Track milk and egg production in separate charts or select an animal group to examine changes in its population.",
    "limit": "Livestock stocks and annual product output measure different things. Species groups cannot be added to product quantities, and goats and sheep cannot be separated from this table. National figures do not show district distribution, herd productivity, farm structure or food access. The published scaling is retained rather than converting thousands or millions to unlabelled counts."
  },
  "presets": [
    {
      "id": "milk",
      "title": "Milk production",
      "description": "Annual national milk production in thousands of litres, 2020–2025.",
      "query": {
        "fields": [
          "year",
          "value"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Milk production"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Milk production",
          "unit": "thousand litres"
        }
      }
    },
    {
      "id": "eggs",
      "title": "Egg production",
      "description": "Annual national egg production in millions of eggs, 2020–2025.",
      "query": {
        "fields": [
          "year",
          "value"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Egg production"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Egg production",
          "unit": "million eggs"
        }
      }
    }
  ]
},
{
  "id": "food-nutrient-availability",
  "title": "Food and nutrient availability",
  "label": "Food availability",
  "themeIds": [
    "AGRI",
    "HEAL",
    "SOCI"
  ],
  "description": "National rice supply and per-person availability of rice, energy, protein and fat.",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "vintage": "Rice balance 2018–2025 and nutrients 2019–2025; 2025 availability not reported",
  "note": {
    "dek": "Rice supply and per-person food energy, protein and fat availability.",
    "question": "How has national food availability changed?",
    "contains": "DCS food-balance figures for 2018–2025 and daily nutrient availability for 2019–2025. The rice table retains its population, paddy production, total supply, net food supply and annual rice availability per person. Nutrient records distinguish vegetable, animal and total sources of energy, protein and fat. The source reports no 2025 rice-availability figures or nutrient figures; it says 2025 nutrient data was unavailable as of 15 September 2026.",
    "use": "Compare rice availability per person through 2024 or track daily food-energy availability. Use the original units to distinguish national supply totals from per-person measures.",
    "limit": "Food-balance availability is not observed food consumption, dietary quality or an estimate of individual nutritional status. The source defines total supply as production plus imports minus exports plus stock changes, and net food supply after deductions for seed, waste, animal feed and manufacturing. National means conceal distribution across households and regions. Totals may differ from the sums of rounded components. Figures from separate crop-production tables can use different precision or revisions. Missing 2025 availability figures are retained as blanks and excluded from the default charts."
  },
  "presets": [
    {
      "id": "rice",
      "title": "Rice availability per person",
      "description": "Annual rice availability in kilograms per person, 2018–2024. The source does not report a 2025 value.",
      "query": {
        "fields": [
          "year",
          "value"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Rice availability per person"
          },
          {
            "field": "category",
            "op": "eq",
            "value": "Total"
          },
          {
            "field": "year",
            "op": "lte",
            "value": 2024
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Rice availability per person",
          "unit": "kg per person per year"
        }
      }
    },
    {
      "id": "energy",
      "title": "Food energy availability",
      "description": "Daily energy availability per person, 2019–2024, from the national food balance. This is not measured dietary intake.",
      "query": {
        "fields": [
          "year",
          "value"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Energy availability"
          },
          {
            "field": "category",
            "op": "eq",
            "value": "Total"
          },
          {
            "field": "year",
            "op": "lte",
            "value": 2024
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Energy availability",
          "unit": "kcal per person per day"
        }
      }
    },
    {
      "id": "protein",
      "title": "Protein availability",
      "description": "Daily protein availability in grams per person, 2019–2024. This is a food-balance measure.",
      "query": {
        "fields": [
          "year",
          "value"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Protein availability"
          },
          {
            "field": "category",
            "op": "eq",
            "value": "Total"
          },
          {
            "field": "year",
            "op": "lte",
            "value": 2024
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Protein availability",
          "unit": "grams per person per day"
        }
      }
    }
  ]
},
{
  "id": "natural-disaster-impacts",
  "title": "Natural disaster impacts",
  "label": "Disaster impacts",
  "themeIds": [
    "ENVI",
    "SOCI",
    "JUST"
  ],
  "description": "Reported numbers of people affected and deaths from floods, drought, lightning, strong wind and landslides.",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "vintage": "2022–2025, Statistical Pocket Book 2026",
  "note": {
    "dek": "Reported people affected and deaths for five natural-disaster categories.",
    "question": "How have the reported human impacts of natural disasters changed?",
    "contains": "National Disaster Relief Service Centre figures compiled by DCS for 2022–2025. The tables report affected people and deaths for floods, drought, lightning, strong wind and landslides. Printed zeros are retained as zero.",
    "use": "Track people reported affected by floods or compare recorded deaths across hazard categories and years.",
    "limit": "These are national administrative reports, not hazard probabilities, event boundaries or estimates of future risk. Only the five published hazard categories are included. The summary does not establish whether affected people are counted more than once across events or categories, so the figures must not be summed as unique people. No district detail, asset losses or service-disruption measures are provided."
  },
  "presets": [
    {
      "id": "flood-affected",
      "title": "People affected by floods",
      "description": "National reported flood-affected people, 2022–2025. Counts are not a measure of future flood risk.",
      "query": {
        "fields": [
          "year",
          "value"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "People affected"
          },
          {
            "field": "hazard",
            "op": "eq",
            "value": "Flood"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "People affected",
          "unit": "people"
        }
      }
    },
    {
      "id": "deaths",
      "title": "Deaths by disaster category",
      "description": "National reported deaths for the five published natural-disaster categories, 2022–2025.",
      "query": {
        "fields": [
          "year",
          "value",
          "hazard"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Deaths"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "hazard",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Deaths",
          "unit": "people"
        },
        "series": {
          "field": "hazard",
          "label": "Disaster category"
        },
        "showLegend": true
      }
    }
  ]
},
{
  "id": "foreign-employment-departures",
  "title": "Foreign employment departures",
  "label": "Foreign employment departures",
  "themeIds": [
    "SOCI",
    "ECON",
    "INTR"
  ],
  "description": "Departures for foreign employment by the published skill categories and sex.",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "vintage": "2017–2025; 2022–2024 revised, Statistical Pocket Book 2026",
  "note": {
    "dek": "Foreign-employment departures, including the skill and sex categories published for each period.",
    "question": "How have foreign-employment departures changed?",
    "contains": "Sri Lanka Bureau of Foreign Employment departure figures for 2017–2025, compiled by DCS. The table provides detailed manpower categories and male/female counts for 2017–2021, plus a domestic-housekeeping category without a sex split. For 2022–2025 it gives broad skilled and low-skilled groups by sex. Total departures are available for all nine years; 2022–2024 figures are revised.",
    "use": "Track total annual departures or compare the broad skill groups by sex in 2025. The original category scheme is recorded for each observation.",
    "limit": "The change from detailed to broad manpower categories prevents a continuous skill-category series. The summary does not explain how all earlier categories, including domestic housekeeping, map into the later groups. No sex is inferred for the unsplit domestic-housekeeping figures. Departures do not measure the stock of Sri Lankans abroad, and the summary does not establish unique migrants or length of stay. Totals overlap their components."
  },
  "presets": [
    {
      "id": "total-departures",
      "title": "Foreign employment departures",
      "description": "Annual total departures for foreign employment, 2017–2025. Figures for 2022–2024 are revised.",
      "query": {
        "fields": [
          "year",
          "value",
          "observation_status"
        ],
        "where": [
          {
            "field": "category",
            "op": "eq",
            "value": "Total"
          },
          {
            "field": "sex",
            "op": "eq",
            "value": "All sexes"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Departures",
          "unit": "departures"
        }
      }
    },
    {
      "id": "skill-sex-2025",
      "title": "Departures by skill group and sex",
      "description": "The broad skill classification reported for 2025. Earlier detailed categories are not combined into this comparison.",
      "query": {
        "fields": [
          "category",
          "value",
          "sex"
        ],
        "where": [
          {
            "field": "year",
            "op": "eq",
            "value": 2025
          },
          {
            "field": "category",
            "op": "in",
            "value": [
              "Skilled",
              "Low-skilled"
            ]
          }
        ],
        "order_by": [
          {
            "field": "category",
            "direction": "asc"
          },
          {
            "field": "sex",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "comparison",
        "dimension": {
          "field": "category",
          "label": "Published skill group"
        },
        "measure": {
          "field": "value",
          "label": "Departures",
          "unit": "departures"
        },
        "series": {
          "field": "sex",
          "label": "Sex"
        },
        "showLegend": true
      }
    }
  ]
},
{
  "id": "employment-by-occupation",
  "title": "Employment by occupation",
  "label": "Employment by occupation",
  "themeIds": [
    "SOCI",
    "ECON"
  ],
  "description": "Employed people aged 15 and over by major occupational group.",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "vintage": "2021–2025, Statistical Pocket Book 2026",
  "note": {
    "dek": "Employment by major occupational group, in thousands of people.",
    "question": "How has the mix of occupations changed?",
    "contains": "DCS Labour Force Survey national estimates for 2021–2025, compiled in the Pocket Book. The table uses ISCO-08 major groups for employed household members aged 15 and over and retains the published overall total. Counts are in thousands of people.",
    "use": "Compare occupational groups in 2025 or track professional, technical and clerical employment over time.",
    "limit": "These are rounded survey estimates, not exact administrative counts, vacancies, wages or employment by industry. Occupation describes the work performed; industry describes the employer’s activity. Armed-forces and unidentified occupations are combined in the source and cannot be separated. Totals overlap their components, and rounding can prevent exact reconciliation. The table has no district or sex breakdown."
  },
  "presets": [
    {
      "id": "occupation-2025",
      "title": "Employment by occupational group",
      "description": "Employed household population aged 15 and over by ISCO-08 major group, 2025, in thousands of people. The overall total is excluded.",
      "query": {
        "fields": [
          "occupation",
          "value"
        ],
        "where": [
          {
            "field": "year",
            "op": "eq",
            "value": 2025
          },
          {
            "field": "isco_group",
            "op": "in",
            "value": [
              "0",
              "1",
              "2",
              "3",
              "4",
              "5",
              "6",
              "7",
              "8",
              "9"
            ]
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "occupation",
          "label": "Occupational group"
        },
        "measure": {
          "field": "value",
          "label": "Employed people",
          "unit": "thousand people"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "selected-occupations",
      "title": "Professional, technical and clerical employment",
      "description": "Published occupation counts in thousands of people, 2021–2025.",
      "query": {
        "fields": [
          "year",
          "value",
          "occupation"
        ],
        "where": [
          {
            "field": "isco_group",
            "op": "in",
            "value": [
              "2",
              "3",
              "4"
            ]
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "isco_group",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Employed people",
          "unit": "thousand people"
        },
        "series": {
          "field": "occupation",
          "label": "Occupational group"
        },
        "showLegend": true
      }
    }
  ]
},
{
  "id": "unemployment-by-province",
  "title": "Unemployment by province",
  "label": "Provincial unemployment",
  "themeIds": [
    "SOCI",
    "ECON",
    "REGI"
  ],
  "description": "Unemployment rates by province and sex, with the source’s high-variability flags.",
  "sourceIds": [
    "dcs-pocketbook-2026",
    "dcs-lfs-2025-annual"
  ],
  "vintage": "2022–2025, Statistical Pocket Book 2026; 2025 LFS weighting methods",
  "note": {
    "dek": "Provincial unemployment rates by sex, including four source sampling-caution flags.",
    "question": "How do unemployment rates vary across provinces?",
    "contains": "Annual DCS Labour Force Survey unemployment rates for 2022–2025, compiled in the Pocket Book. The data covers nine provinces and the national figure, with male, female and both-sex rates for the household population aged 15 and over. Four blue-shaded source cells are identified with a sampling-caution flag. The original 2025 annual report supplies the weighting-method context.",
    "use": "Compare both-sex provincial unemployment rates in 2025 or follow their annual changes. When selecting sex-specific figures, include the sampling-caution field.",
    "limit": "Unemployment is a percentage of the labour force within the reported sex and geography, not a share of the whole working-age population. Provincial rates cannot be averaged to obtain the national rate. The source flags North Central female unemployment in 2024, North Central male unemployment in 2025, Sabaragamuwa male unemployment in 2025 and Eastern male unemployment in 2024 because of high coefficients of variation. No confidence intervals are supplied in this summary. The 2025 annual report says 2025 estimates were reweighted using the 2024 Census; the Pocket Book does not document a comparable reweighting for earlier years."
  },
  "presets": [
    {
      "id": "province-2025",
      "title": "Unemployment rate by province",
      "description": "Both-sex unemployment rates by province, 2025, as a percentage of each province’s labour force. The national figure is excluded.",
      "query": {
        "fields": [
          "geography",
          "value"
        ],
        "where": [
          {
            "field": "year",
            "op": "eq",
            "value": 2025
          },
          {
            "field": "sex",
            "op": "eq",
            "value": "Both sexes"
          },
          {
            "field": "geography_type",
            "op": "eq",
            "value": "province"
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "geography",
          "label": "Province"
        },
        "measure": {
          "field": "value",
          "label": "Unemployment rate",
          "unit": "% of labour force"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "province-history",
      "title": "Provincial unemployment rates",
      "description": "Both-sex provincial unemployment rates, 2022–2025. The source’s high-variability flags concern selected sex-specific figures; 2025 also uses updated census population weights.",
      "query": {
        "fields": [
          "year",
          "value",
          "geography"
        ],
        "where": [
          {
            "field": "sex",
            "op": "eq",
            "value": "Both sexes"
          },
          {
            "field": "geography_type",
            "op": "eq",
            "value": "province"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "geography",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Unemployment rate",
          "unit": "% of labour force"
        },
        "series": {
          "field": "geography",
          "label": "Province"
        },
        "showLegend": true
      }
    }
  ]
},
{
  "id": "household-income-inequality",
  "title": "Household income and inequality",
  "label": "Income and inequality",
  "themeIds": [
    "ECON",
    "SOCI",
    "REGI"
  ],
  "description": "Mean monthly household income and the household-income Gini coefficient by residential sector.",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "vintage": "HIES survey rounds 2006/07–2019, Statistical Pocket Book 2026",
  "note": {
    "dek": "Mean household income and income inequality in urban, rural and estate sectors.",
    "question": "How did household income and inequality differ across residential sectors?",
    "contains": "DCS Household Income and Expenditure Survey results from 2006/07, 2009/10, 2012/13, 2016 and 2019. The table reports mean monthly household income in current Sri Lankan rupees and the household-income Gini coefficient, nationally and for urban, rural and estate sectors. The 2006/07 round excludes Northern Province and Trincomalee; 2009/10 excludes Mannar, Kilinochchi and Mullaitivu.",
    "use": "Compare sector income and inequality from the full-island 2012/13 round onward. Earlier rounds remain available with their geographic exclusions.",
    "limit": "These historical survey results end in 2019 and cannot describe current household incomes. Income is a mean per household, not a median, per-person income or inflation-adjusted amount. Gini uses a 0–1 scale and cannot be added across sectors. Coverage changes prevent treating the early rounds as an unchanged national series. Survey periods and sector definitions must be retained."
  },
  "presets": [
    {
      "id": "sector-income",
      "title": "Mean monthly household income by sector",
      "description": "Urban, rural and estate household means in current Sri Lankan rupees, 2012/13, 2016 and 2019. Earlier rounds with geographic exclusions are omitted.",
      "query": {
        "fields": [
          "survey_period",
          "value",
          "sector"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Mean monthly household income"
          },
          {
            "field": "end_year",
            "op": "gte",
            "value": 2013
          },
          {
            "field": "sector",
            "op": "in",
            "value": [
              "Urban",
              "Rural",
              "Estate"
            ]
          }
        ],
        "order_by": [
          {
            "field": "end_year",
            "direction": "asc"
          },
          {
            "field": "sector",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "survey_period",
          "label": "Survey round"
        },
        "measure": {
          "field": "value",
          "label": "Mean monthly household income",
          "unit": "LKR per household per month"
        },
        "series": {
          "field": "sector",
          "label": "Residential sector"
        },
        "showLegend": true
      }
    },
    {
      "id": "income-gini",
      "title": "Household income inequality",
      "description": "Household-income Gini coefficients, 2012/13, 2016 and 2019, on a 0–1 scale.",
      "query": {
        "fields": [
          "survey_period",
          "value",
          "sector"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Household income Gini"
          },
          {
            "field": "end_year",
            "op": "gte",
            "value": 2013
          }
        ],
        "order_by": [
          {
            "field": "end_year",
            "direction": "asc"
          },
          {
            "field": "sector",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "survey_period",
          "label": "Survey round"
        },
        "measure": {
          "field": "value",
          "label": "Household income Gini",
          "unit": "0–1"
        },
        "series": {
          "field": "sector",
          "label": "Residential sector"
        },
        "showLegend": true
      }
    }
  ]
},
{
  "id": "household-expenditure",
  "title": "Household expenditure",
  "label": "Household expenditure",
  "themeIds": [
    "ECON",
    "SOCI",
    "REGI"
  ],
  "description": "Monthly household expenditure on selected food and nonfood categories, with reported food quantities.",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "vintage": "HIES 2009/10–2019; food quantities and expenditure 2012/13–2019",
  "note": {
    "dek": "Historical household spending on food, housing, utilities, transport and other categories.",
    "question": "How did household spending vary across categories and survey rounds?",
    "contains": "DCS Household Income and Expenditure Survey means compiled in the 2026 Pocket Book. Selected food expenditure and quantities cover 2012/13, 2016 and 2019. Nonfood expenditure covers 2009/10, 2012/13, 2016 and 2019. Spending is in current Sri Lankan rupees per household per month; food quantities retain their separate units. The 2009/10 round excludes Mannar, Kilinochchi and Mullaitivu.",
    "use": "Compare selected food-category expenditure in 2019 or track housing expenditure from the full-island 2012/13 round onward. Rice and other reported food quantities can be selected separately.",
    "limit": "The figures end in 2019 and do not describe current living costs. Means are per household, not per person, and prices are not adjusted for inflation. Only selected food categories are included, so they do not establish a complete household budget. The source separately reports other non-consumer expenditure; it should not be treated as household consumption. Quantity columns for aggregate food groups have no common unit and contain dashes; those cells remain without numeric values, with review notes. Quantities do not measure individual dietary intake."
  },
  "presets": [
    {
      "id": "food-2019",
      "title": "Monthly food expenditure by category",
      "description": "Mean monthly household expenditure on the selected food categories, HIES 2019, in current Sri Lankan rupees.",
      "query": {
        "fields": [
          "category",
          "value"
        ],
        "where": [
          {
            "field": "group",
            "op": "eq",
            "value": "Food"
          },
          {
            "field": "metric",
            "op": "eq",
            "value": "Expenditure"
          },
          {
            "field": "end_year",
            "op": "eq",
            "value": 2019
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "category",
          "label": "Food category"
        },
        "measure": {
          "field": "value",
          "label": "Monthly expenditure",
          "unit": "LKR per household per month"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "housing",
      "title": "Monthly household expenditure on housing",
      "description": "Household survey means for 2012/13, 2016 and 2019, in current Sri Lankan rupees per month. The earlier round with geographic exclusions is omitted.",
      "query": {
        "fields": [
          "survey_period",
          "value"
        ],
        "where": [
          {
            "field": "category",
            "op": "eq",
            "value": "Housing"
          },
          {
            "field": "metric",
            "op": "eq",
            "value": "Expenditure"
          },
          {
            "field": "end_year",
            "op": "gte",
            "value": 2013
          }
        ],
        "order_by": [
          {
            "field": "end_year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "survey_period",
          "label": "Survey round"
        },
        "measure": {
          "field": "value",
          "label": "Housing expenditure",
          "unit": "LKR per household per month"
        }
      }
    }
  ]
},
{
  "id": "poverty-depth-severity",
  "title": "Poverty depth and severity",
  "label": "Poverty depth and severity",
  "themeIds": [
    "SOCI",
    "ECON",
    "REGI"
  ],
  "description": "Poverty-gap and squared poverty-gap indices by residential sector and poverty-line definition.",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "vintage": "HIES 2012/13, 2016 and 2019; old and updated poverty-line definitions",
  "note": {
    "dek": "Poverty-gap and squared-gap indices for urban, rural and estate sectors.",
    "question": "How do published poverty-depth measures differ across sectors and poverty lines?",
    "contains": "DCS Household Income and Expenditure Survey poverty-gap and squared-gap indices for 2012/13, 2016 and 2019, nationally and by urban, rural and estate sector. The older line is based on HIES 2002 and adjusted with CCPI. The updated line is based on HIES 2012/13 and adjusted with NCPI for 2019. Both line definitions are retained as separate observations.",
    "use": "Compare sectors using the updated poverty line in 2019. The older-line observations allow historical comparisons within that definition.",
    "limit": "These are historical survey indices ending in 2019, not current poverty estimates. The older and updated poverty lines cannot be joined into one unchanged series. Poverty-gap and squared-gap indices measure different aspects of poverty and must not be added together. The source prints the 2019 estate-sector old-line poverty gap as 1,2; its decimal comma was reviewed as 1.2, with the original token retained."
  },
  "presets": [
    {
      "id": "gap-2019",
      "title": "Poverty gap by sector",
      "description": "Poverty gap index by residential sector in HIES 2019, using the updated 2012/13-based poverty line adjusted with NCPI.",
      "query": {
        "fields": [
          "sector",
          "value"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Poverty gap index"
          },
          {
            "field": "end_year",
            "op": "eq",
            "value": 2019
          },
          {
            "field": "poverty_line_base",
            "op": "eq",
            "value": "2012/13"
          },
          {
            "field": "sector",
            "op": "in",
            "value": [
              "Urban",
              "Rural",
              "Estate"
            ]
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "sector",
          "label": "Residential sector"
        },
        "measure": {
          "field": "value",
          "label": "Poverty gap index",
          "unit": "%"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "squared-gap-2019",
      "title": "Squared poverty gap by sector",
      "description": "Squared poverty gap index by residential sector in HIES 2019, using the updated 2012/13-based poverty line adjusted with NCPI.",
      "query": {
        "fields": [
          "sector",
          "value"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Squared poverty gap index"
          },
          {
            "field": "end_year",
            "op": "eq",
            "value": 2019
          },
          {
            "field": "poverty_line_base",
            "op": "eq",
            "value": "2012/13"
          },
          {
            "field": "sector",
            "op": "in",
            "value": [
              "Urban",
              "Rural",
              "Estate"
            ]
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "sector",
          "label": "Residential sector"
        },
        "measure": {
          "field": "value",
          "label": "Squared poverty gap index",
          "unit": "%"
        },
        "orientation": "horizontal"
      }
    }
  ]
},
{
  "id": "national-road-length",
  "title": "National road network length",
  "label": "National road length",
  "themeIds": [
    "TRAN",
    "REGI"
  ],
  "description": "Length of A- and B-class national roads by province and expressways nationally.",
  "sourceIds": [
    "dcs-abstract-2025-road-length"
  ],
  "vintage": "2020–2024, Statistical Abstract 2025",
  "note": {
    "dek": "Provincial A- and B-class road lengths and national expressway length.",
    "question": "How is the national road network distributed across provinces?",
    "contains": "Road Development Authority inventory figures compiled by DCS for 2020–2024. The table gives A- and B-class road length for each of nine provinces and their national total, plus national expressway length. All figures are in kilometres.",
    "use": "Compare provincial A- and B-class road length in 2024 or track national expressway length over the five reported years.",
    "limit": "Coverage is limited to the two national-road classes and expressways; it is not the length of every public road. Provincial and local-government road networks are not included as separate inventories here. National totals overlap provincial components. Precision varies in the source, including one-decimal provincial figures for 2021. Length alone does not measure traffic, road condition, lane capacity or accessibility, and the table contains no route geometry."
  },
  "presets": [
    {
      "id": "province-2024",
      "title": "A- and B-class road length by province",
      "description": "Provincial national-road lengths in kilometres, 2024. Expressways and the national total are excluded.",
      "query": {
        "fields": [
          "geography",
          "value"
        ],
        "where": [
          {
            "field": "year",
            "op": "eq",
            "value": 2024
          },
          {
            "field": "road_class",
            "op": "eq",
            "value": "A and B"
          },
          {
            "field": "geography_type",
            "op": "eq",
            "value": "province"
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "geography",
          "label": "Province"
        },
        "measure": {
          "field": "value",
          "label": "Road length",
          "unit": "km"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "expressways",
      "title": "National expressway length",
      "description": "Reported expressway length in kilometres, 2020–2024.",
      "query": {
        "fields": [
          "year",
          "value"
        ],
        "where": [
          {
            "field": "road_class",
            "op": "eq",
            "value": "Expressway"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Expressway length",
          "unit": "km"
        }
      }
    }
  ]
},
{
  "id": "building-construction-district",
  "title": "Building construction by district",
  "label": "Building construction",
  "themeIds": [
    "REGI",
    "ECON"
  ],
  "description": "Constructed residential and non-residential buildings, additions and alterations, and their floor space by district.",
  "sourceIds": [
    "dcs-abstract-2025-buildings"
  ],
  "vintage": "2024, Statistical Abstract 2025",
  "note": {
    "dek": "District counts and floor space of newly constructed buildings and additions or alterations.",
    "question": "Where were new buildings and alterations reported in 2024?",
    "contains": "DCS figures for all 25 districts and the national total in 2024. The table distinguishes new residential buildings, new non-residential buildings, and additions or alterations. Each category has a building count and floor space in square feet.",
    "use": "Compare districts by the number of new residential buildings or by new non-residential floor space. Keep the three construction categories and their units separate.",
    "limit": "This is one year of reported construction, not the stock of all buildings, housing units or a register of planning approvals. Additions and alterations affect existing buildings and cannot be added to new construction as a count of new buildings. District totals do not locate projects or establish their occupancy, value or legal status. Four non-residential floor-space figures have misplaced commas in the PDF; their digits are retained with reviewed grouping and the original tokens remain attached to the observations."
  },
  "presets": [
    {
      "id": "residential-buildings",
      "title": "New residential buildings by district",
      "description": "New residential buildings reported as constructed in 2024. The national total is excluded.",
      "query": {
        "fields": [
          "geography",
          "value"
        ],
        "where": [
          {
            "field": "construction_type",
            "op": "eq",
            "value": "New residential"
          },
          {
            "field": "metric",
            "op": "eq",
            "value": "Buildings"
          },
          {
            "field": "geography_type",
            "op": "eq",
            "value": "district"
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "geography",
          "label": "District"
        },
        "measure": {
          "field": "value",
          "label": "New residential buildings",
          "unit": "buildings"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "nonresidential-floor-space",
      "title": "New non-residential floor space by district",
      "description": "Floor space of new non-residential buildings reported as constructed in 2024, in square feet.",
      "query": {
        "fields": [
          "geography",
          "value"
        ],
        "where": [
          {
            "field": "construction_type",
            "op": "eq",
            "value": "New non-residential"
          },
          {
            "field": "metric",
            "op": "eq",
            "value": "Floor space"
          },
          {
            "field": "geography_type",
            "op": "eq",
            "value": "district"
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "geography",
          "label": "District"
        },
        "measure": {
          "field": "value",
          "label": "Floor space",
          "unit": "sq ft"
        },
        "orientation": "horizontal"
      }
    }
  ]
},
{
  "id": "port-traffic-cargo",
  "title": "Port traffic and cargo",
  "label": "Port traffic and cargo",
  "themeIds": [
    "TRAN",
    "ECON",
    "INTR"
  ],
  "description": "Ship arrivals, reported vessel tonnage and cargo handling at the published port groups.",
  "sourceIds": [
    "dcs-abstract-2025-port-traffic",
    "dcs-abstract-2025-colombo-cargo",
    "dcs-abstract-2025-port-cargo"
  ],
  "vintage": "Colombo cargo 2016–2024; port traffic and cargo by port 2018–2024",
  "note": {
    "dek": "Ship traffic and cargo volumes at Colombo and four other reported port groups.",
    "question": "How have port traffic and cargo volumes changed?",
    "contains": "Sri Lanka Ports Authority figures compiled by DCS in Statistical Abstract 2025. Ship arrivals and reported gross/net vessel tonnage cover five port groups in 2018–2024. Cargo by port covers the same years, while a separate Colombo table extends to 2016 and distinguishes domestic, transhipment and re-stowed cargo loaded and discharged. Original port names and table identifiers remain available.",
    "use": "Track Colombo cargo using table 7.13, compare port totals using table 7.14, or examine ship arrivals using table 7.12. Select one table and measure before comparing years.",
    "limit": "Totals and components overlap. Vessel tonnage is kept on the source’s reported scale and must not be read as cargo mass. Missing years remain blank. Table identifiers distinguish conflicting Colombo totals. Table 7.14 has an ambiguous discharge label and two totals inconsistent with their components; affected observations have review notes. Ship arrivals exclude naval vessels, fishing trawlers, yachts and dredgers and do not count unique ships."
  },
  "presets": [
    {
      "id": "colombo-cargo",
      "title": "Cargo handled at Colombo",
      "description": "Total cargo handled at Colombo, 2016–2024, in thousand tons as reported in table 7.13.",
      "query": {
        "fields": [
          "year",
          "value"
        ],
        "where": [
          {
            "field": "report_table",
            "op": "eq",
            "value": "7.13"
          },
          {
            "field": "metric",
            "op": "eq",
            "value": "Total cargo handled"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Cargo handled at Colombo",
          "unit": "thousand tons"
        }
      }
    },
    {
      "id": "port-cargo",
      "title": "Cargo handled by port",
      "description": "Published port totals from table 7.14, 2018–2024, in thousand tons. Some source totals have documented discrepancies.",
      "query": {
        "fields": [
          "year",
          "value",
          "port"
        ],
        "where": [
          {
            "field": "report_table",
            "op": "eq",
            "value": "7.14"
          },
          {
            "field": "metric",
            "op": "eq",
            "value": "Total cargo handled"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "port",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Cargo handled by port",
          "unit": "thousand tons"
        },
        "series": {
          "field": "port",
          "label": "Port group"
        },
        "showLegend": true
      }
    },
    {
      "id": "ship-arrivals",
      "title": "Ship arrivals by port",
      "description": "Reported ship arrivals, 2018–2024, excluding naval vessels, fishing trawlers, yachts and dredgers.",
      "query": {
        "fields": [
          "year",
          "value",
          "port"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Ship arrivals"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "port",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Ship arrivals by port",
          "unit": "ship arrivals"
        },
        "series": {
          "field": "port",
          "label": "Port group"
        },
        "showLegend": true
      }
    }
  ]
},
{
  "id": "colombo-port-performance",
  "title": "Colombo port performance",
  "label": "Port performance",
  "themeIds": [
    "TRAN",
    "ECON",
    "INTR"
  ],
  "description": "Average ship waiting, service and turnaround times and cargo handling per ship-hour at Colombo.",
  "sourceIds": [
    "dcs-abstract-2025-port-performance"
  ],
  "vintage": "2018–2024, Statistical Abstract 2025",
  "note": {
    "dek": "Ship time in port and cargo handling rates at Colombo.",
    "question": "How have ship times and cargo handling rates changed at Colombo?",
    "contains": "Sri Lanka Ports Authority annual averages compiled by DCS for 2018–2024. Each measure distinguishes container and non-container ships. Time measures are average waiting, service and turnaround time in hours. Handling rates are metric tonnes per ship-hour at berth and in port.",
    "use": "Compare container and non-container turnaround time, waiting time or handling rates over the reported years. Keep time measures separate from throughput rates.",
    "limit": "These are annual averages for Colombo, not individual-ship records, maximum delays, terminal-specific performance or service guarantees. Different time measures cannot be substituted for one another or added as a verified identity. Ship size, cargo mix and operating conditions can affect the averages; the table does not establish causes of changes. Tonnage rates are metric tonnes per ship-hour, not container counts or TEU productivity."
  },
  "presets": [
    {
      "id": "turnaround",
      "title": "Average ship turnaround time",
      "description": "Average ship turnaround time at Colombo, by container and non-container ship type, 2018–2024.",
      "query": {
        "fields": [
          "year",
          "value",
          "ship_type"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Average turnaround time"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "ship_type",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Average ship turnaround time",
          "unit": "hours"
        },
        "series": {
          "field": "ship_type",
          "label": "Ship type"
        },
        "showLegend": true
      }
    },
    {
      "id": "waiting",
      "title": "Average ship waiting time",
      "description": "Average ship waiting time at Colombo, by container and non-container ship type, 2018–2024.",
      "query": {
        "fields": [
          "year",
          "value",
          "ship_type"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Average waiting time"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "ship_type",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Average ship waiting time",
          "unit": "hours"
        },
        "series": {
          "field": "ship_type",
          "label": "Ship type"
        },
        "showLegend": true
      }
    },
    {
      "id": "berth-productivity",
      "title": "Cargo handled per ship-hour at berth",
      "description": "Cargo handled per ship-hour at berth at Colombo, by container and non-container ship type, 2018–2024.",
      "query": {
        "fields": [
          "year",
          "value",
          "ship_type"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Cargo per ship-hour at berth"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "ship_type",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Cargo handled per ship-hour at berth",
          "unit": "metric tonnes per ship-hour"
        },
        "series": {
          "field": "ship_type",
          "label": "Ship type"
        },
        "showLegend": true
      }
    }
  ]
},
{
  "id": "water-supply-connections-coverage",
  "title": "Water supply connections and coverage",
  "label": "Water supply access",
  "themeIds": [
    "REGI",
    "ENVI",
    "SOCI"
  ],
  "description": "NWSDB service connections by operational geography and reported national water-supply coverage.",
  "sourceIds": [
    "nwsdb-annual-report-2024"
  ],
  "vintage": "Connections at end-2023 and end-2024; coverage 2015–2024, NWSDB Annual Report 2024",
  "note": {
    "dek": "Water connections by utility region and national pipe-borne water coverage.",
    "question": "How many water connections are served, and how has reported coverage changed?",
    "contains": "The NWSDB 2024 annual report provides end-year service connections for regional support centres and operational regions in 2023 and 2024, including both independently published national totals. It also provides 2015–2024 pipe-borne population coverage for NWSDB, other providers and the national total, plus its reported safe-water coverage for 2023 and 2024. Embedded table and figure labels were read visually against the original report.",
    "use": "Compare operational-region connection counts in 2024 or track national pipe-borne water coverage. Choose either the support-centre or operational-region breakdown to avoid counting the same connections twice.",
    "limit": "Utility regions are operational areas and must not be assumed to match administrative districts or provinces. Regional support centres and their operational regions overlap, as do their national totals. Connections are service points, not people or households. Coverage percentages refer to population and use the report’s definitions; safe-water coverage is a separately reported indicator. Coverage components and published totals can differ slightly through rounding. Figure labels provide rounded historical percentages; no unlabelled chart values are estimated."
  },
  "presets": [
    {
      "id": "region-connections",
      "title": "Water connections by operational region",
      "description": "NWSDB service connections at the end of December 2024. National totals and regional-support-centre aggregates are excluded.",
      "query": {
        "fields": [
          "geography",
          "value"
        ],
        "where": [
          {
            "field": "year",
            "op": "eq",
            "value": 2024
          },
          {
            "field": "metric",
            "op": "eq",
            "value": "Water service connections"
          },
          {
            "field": "geography_scheme",
            "op": "eq",
            "value": "Operational region"
          },
          {
            "field": "is_national_total",
            "op": "eq",
            "value": false
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "geography",
          "label": "NWSDB operational region"
        },
        "measure": {
          "field": "value",
          "label": "Service connections",
          "unit": "connections"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "pipeborne-coverage",
      "title": "Pipe-borne water supply coverage",
      "description": "Reported national population coverage, 2015–2024. NWSDB, other-provider and national-total series overlap and are not additive.",
      "query": {
        "fields": [
          "year",
          "value",
          "provider_group"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Pipe-borne water coverage"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "provider_group",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Population coverage",
          "unit": "% of population"
        },
        "series": {
          "field": "provider_group",
          "label": "Provider group"
        },
        "showLegend": true
      }
    }
  ]
},
{
  "id": "water-operating-performance",
  "title": "Water utility operating performance",
  "label": "Water utility performance",
  "themeIds": [
    "ENVI",
    "REGI",
    "SOCI",
    "HEAL"
  ],
  "description": "NWSDB water production, consumption, non-revenue water, staffing and bacteriological sample results.",
  "sourceIds": [
    "nwsdb-annual-report-2024"
  ],
  "vintage": "2015–2024, NWSDB Annual Report 2024",
  "note": {
    "dek": "Water volumes, non-revenue water and utility service measures since 2015.",
    "question": "How have water production, losses and operating measures changed?",
    "contains": "The NWSDB 2024 annual report prints ten-year series for water production and consumption, non-revenue water, staff per 1,000 connections and the share of water samples passing bacteriological tests. These labelled figure values are preserved along with the more precise 2023–2024 non-revenue-water and staffing figures in table 5.",
    "use": "Compare production and consumption volumes, or inspect the reported non-revenue-water and bacteriological pass-rate histories. Filter by report section to choose the rounded historical figure or the more precise recent table.",
    "limit": "The figures describe NWSDB operations, not every water provider or household. Historical volume labels are rounded to million cubic metres; recomputing non-revenue water from them will not reproduce the unrounded underlying ratio. Non-revenue water includes more than physical leaks. Bacteriological pass rates describe tested samples, not population coverage or a guarantee for each connection. Table 5 wrongly labels staff per 1,000 connections as a percentage; figure 36 confirms that the measure is a staffing ratio. The original unit error is recorded in the affected cell notes. Overlapping table and figure observations must not be summed."
  },
  "presets": [
    {
      "id": "water-volumes",
      "title": "Water production and consumption",
      "description": "NWSDB water volumes, 2015–2024. Values are the rounded million-cubic-metre labels printed in figure 33.",
      "query": {
        "fields": [
          "year",
          "value",
          "metric"
        ],
        "where": [
          {
            "field": "unit",
            "op": "eq",
            "value": "million m³"
          },
          {
            "field": "report_section",
            "op": "eq",
            "value": "Figure 33"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "metric",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Water volume",
          "unit": "million m³"
        },
        "series": {
          "field": "metric",
          "label": "Measure"
        },
        "showLegend": true
      }
    },
    {
      "id": "non-revenue-water",
      "title": "Non-revenue water",
      "description": "NWSDB annual reported non-revenue water, 2015–2024. Historical figure labels retain their published rounding.",
      "query": {
        "fields": [
          "year",
          "value"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Non-revenue water"
          },
          {
            "field": "report_section",
            "op": "eq",
            "value": "Figure 33"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Non-revenue water",
          "unit": "%"
        }
      }
    },
    {
      "id": "bacteriological-quality",
      "title": "Bacteriological sample pass rate",
      "description": "NWSDB annual reported bacteriological sample pass rate, 2015–2024. Historical figure labels retain their published rounding.",
      "query": {
        "fields": [
          "year",
          "value"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Bacteriological sample pass rate"
          },
          {
            "field": "report_section",
            "op": "eq",
            "value": "Figure 38"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Bacteriological sample pass rate",
          "unit": "% of tested samples"
        }
      }
    }
  ]
},
{
  "id": "household-waste-disposal",
  "title": "Household waste disposal",
  "label": "Household waste disposal",
  "themeIds": [
    "ENVI",
    "REGI",
    "SOCI"
  ],
  "description": "Household solid- and liquid-waste disposal methods by census sector in 2024.",
  "sourceIds": [
    "dcs-cph-2024-final-report"
  ],
  "vintage": "Census of Population and Housing 2024, final report tables 11.17–11.18",
  "note": {
    "dek": "How households dispose of solid and liquid waste across census sectors.",
    "question": "How do waste-disposal methods differ between urban, rural and estate households?",
    "contains": "The 2024 census reports household shares by main disposal method for biodegradable waste, polythene and plastic, electronic waste, glass and bottles, other solid waste, and liquid waste. Figures cover Sri Lanka and four separately reported sectors: urban, estate-urban, rural and estate-rural. The solid-waste table also reports each sector’s household count.",
    "use": "Compare local-authority collection across waste types and sectors, or inspect the national distribution of plastic and liquid-waste disposal methods. Use household counts only as their own measure.",
    "limit": "These are reported household practices, not tonnes collected, collection frequency, recycling rates or wastewater-treatment quality. Sector percentages have different household denominators and cannot be added or averaged without weights. The national total overlaps the four sectors. Published percentages are rounded; 0.0 can conceal a small nonzero share. Missing methods within a waste type are not assigned zero. The source wording Composing solid waste is retained. This import uses the downloaded final-report edition; older cached copies at the same URL can contain different biodegradable-waste percentages."
  },
  "presets": [
    {
      "id": "local-authority-collection",
      "title": "Local authority waste collection",
      "description": "Households reporting local-authority disposal by solid-waste type and census sector, 2024. Estate sectors are shown separately.",
      "query": {
        "fields": [
          "waste_type",
          "value",
          "sector"
        ],
        "where": [
          {
            "field": "method",
            "op": "eq",
            "value": "By the local authority"
          },
          {
            "field": "sector",
            "op": "in",
            "value": [
              "Urban",
              "Estate-Urban",
              "Rural",
              "Estate-Rural"
            ]
          }
        ],
        "order_by": [
          {
            "field": "waste_type",
            "direction": "asc"
          },
          {
            "field": "sector",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "comparison",
        "dimension": {
          "field": "waste_type",
          "label": "Waste type"
        },
        "measure": {
          "field": "value",
          "label": "Household share",
          "unit": "% of households"
        },
        "series": {
          "field": "sector",
          "label": "Census sector"
        },
        "showLegend": true
      }
    },
    {
      "id": "plastic-disposal",
      "title": "Plastic waste disposal",
      "description": "National household shares by main disposal method for polythene and plastic, 2024. The total is excluded.",
      "query": {
        "fields": [
          "method",
          "value"
        ],
        "where": [
          {
            "field": "waste_type",
            "op": "eq",
            "value": "Polythene and plastic"
          },
          {
            "field": "sector",
            "op": "eq",
            "value": "Sri Lanka"
          },
          {
            "field": "method",
            "op": "in",
            "value": [
              "By the local authority",
              "Occupants burn",
              "Occupants dispose within the premises",
              "Composing solid waste",
              "Dispose into road, river, canal, sea, lagoon or forest",
              "Provide to the waste collectors",
              "Other"
            ]
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "method",
          "label": "Main disposal method"
        },
        "measure": {
          "field": "value",
          "label": "Household share",
          "unit": "% of households"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "liquid-disposal",
      "title": "Liquid waste disposal",
      "description": "National household shares by main liquid-waste disposal method, 2024. These methods do not describe wastewater volumes or treatment quality.",
      "query": {
        "fields": [
          "method",
          "value"
        ],
        "where": [
          {
            "field": "waste_type",
            "op": "eq",
            "value": "Liquid waste"
          },
          {
            "field": "sector",
            "op": "eq",
            "value": "Sri Lanka"
          },
          {
            "field": "method",
            "op": "in",
            "value": [
              "To a properly closed pit",
              "Open pit",
              "Within the premises",
              "Connected to a piped sewer",
              "To a stream, spring, river or sea",
              "To a drain on road",
              "Other"
            ]
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "method",
          "label": "Main disposal method"
        },
        "measure": {
          "field": "value",
          "label": "Household share",
          "unit": "% of households"
        },
        "orientation": "horizontal"
      }
    }
  ]
},
{
  "id": "road-crashes-fatalities",
  "title": "Road crashes and fatalities",
  "label": "Road safety",
  "themeIds": [
    "REGI",
    "SOCI",
    "TRAN",
    "JUST"
  ],
  "description": "Reported road crashes by severity and police geography, with 2024 fatalities by road-user group.",
  "sourceIds": [
    "ntc-statistics-2024",
    "dcs-abstract-2025-road-accidents"
  ],
  "vintage": "National crashes 2010–2023; police divisions 2023; Colombo station areas 2020–2024; road-user fatalities 2024",
  "note": {
    "dek": "Reported road crashes by severity, police division and Colombo station area.",
    "question": "Where are crashes reported, and which road users are killed?",
    "contains": "National Transport Statistics 2024 supplies the 2010–2023 national crash series and 2023 crash counts by police division, classified by fatal, grievous-injury, non-grievous-injury and damage-only outcomes. The DCS Statistical Abstract adds Colombo police-station-area crash counts for 2020–2024 and national 2024 fatalities by road-user group. Both publications attribute their figures to the Police.",
    "use": "Track crashes within the national series, compare 2023 police divisions, examine Colombo station areas, or inspect the 2024 road-user fatality distribution. Choose the required table and geographic scheme before comparing observations.",
    "limit": "Counts include crashes reported to police and do not measure exposure-adjusted risk. Fatal crashes count events; fatalities count people. Police divisions and station areas are not administrative districts, and overlapping national and city totals must not be added. National figures in later publications can differ from the NTC edition; its historical series is retained without splicing. DCS table 7.4 has conflicting national death figures and is excluded. Only the unmerged 2024 road-user breakdown is included from table 7.6. A dash in the Colombo table retains a nil-or-negligible status rather than an exact zero."
  },
  "presets": [
    {
      "id": "crash-history",
      "title": "Reported road crashes",
      "description": "National crashes by severity, 2010–2023, as published in NTC table 9.1. Fatal crashes count events rather than people killed.",
      "query": {
        "fields": [
          "year",
          "value",
          "severity"
        ],
        "where": [
          {
            "field": "report_table",
            "op": "eq",
            "value": "NTC 9.1"
          },
          {
            "field": "severity",
            "op": "in",
            "value": [
              "Fatal",
              "Grievous injury",
              "Non-grievous injury",
              "Damage only"
            ]
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "severity",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Reported crashes",
          "unit": "crashes"
        },
        "series": {
          "field": "severity",
          "label": "Outcome severity"
        },
        "showLegend": true
      }
    },
    {
      "id": "division-crashes",
      "title": "Road crashes by police division",
      "description": "All reported crashes by police division in 2023, NTC table 9.3. These divisions are not administrative districts.",
      "query": {
        "fields": [
          "geography",
          "value"
        ],
        "where": [
          {
            "field": "report_table",
            "op": "eq",
            "value": "NTC 9.3"
          },
          {
            "field": "severity",
            "op": "eq",
            "value": "Total"
          },
          {
            "field": "is_geography_total",
            "op": "eq",
            "value": false
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "geography",
          "label": "Police division"
        },
        "measure": {
          "field": "value",
          "label": "Reported crashes",
          "unit": "crashes"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "fatalities-road-user",
      "title": "Road fatalities by road user",
      "description": "People killed nationally in 2024, DCS table 7.6. The total is excluded from the category comparison.",
      "query": {
        "fields": [
          "road_user",
          "value"
        ],
        "where": [
          {
            "field": "report_table",
            "op": "eq",
            "value": "DCS 7.6"
          },
          {
            "field": "road_user",
            "op": "in",
            "value": [
              "Passengers",
              "Pedestrians",
              "Drivers of vehicles",
              "Pedal cyclists",
              "Riders of motor cycles, scooters or cycles fitted with motors",
              "Back riders",
              "Other"
            ]
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "road_user",
          "label": "Road-user group"
        },
        "measure": {
          "field": "value",
          "label": "People killed",
          "unit": "people"
        },
        "orientation": "horizontal"
      }
    }
  ]
},
{
  "id": "household-equipment-use",
  "title": "Household equipment use",
  "label": "Household equipment use",
  "themeIds": [
    "SOCI",
    "REGI",
    "TECH",
    "TRAN"
  ],
  "description": "Household use of communications equipment, internet facilities and vehicles by census sector.",
  "sourceIds": [
    "dcs-cph-2024-final-report"
  ],
  "vintage": "Census 2024, final report table 11.19",
  "note": {
    "dek": "Household use of phones, computers, internet facilities and vehicles.",
    "question": "How does household equipment use differ across census sectors?",
    "contains": "The 2024 census reports the share of households using 13 types of communications equipment, internet facilities and vehicles. The table covers Sri Lanka and the urban, estate-urban, rural and estate-rural sectors. Equipment includes phones, computers, radio, television, bicycles, motorcycles or scooters, and three-wheelers.",
    "use": "Compare household internet-facility use by sector, examine national communications-equipment use, or compare household use of the three named vehicle categories.",
    "limit": "The census measures use regardless of ownership. These figures are neither device counts nor subscriptions, individual internet-use rates, registered vehicle stocks or measures of connection quality. Households can use several types of equipment, so categories are not additive. Sector shares use different household denominators; the national figure overlaps the four sectors. Other is left as the source’s unspecified category. Percentages are rounded to one decimal place."
  },
  "presets": [
    {
      "id": "household-internet",
      "title": "Household internet facilities",
      "description": "Households using internet facilities by census sector, 2024. The national total is excluded from the sector comparison.",
      "query": {
        "fields": [
          "sector",
          "value"
        ],
        "where": [
          {
            "field": "equipment",
            "op": "eq",
            "value": "Internet facilities"
          },
          {
            "field": "sector",
            "op": "in",
            "value": [
              "Urban",
              "Estate-Urban",
              "Rural",
              "Estate-Rural"
            ]
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "sector",
          "label": "Census sector"
        },
        "measure": {
          "field": "value",
          "label": "Households using internet facilities",
          "unit": "% of households"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "communications-equipment",
      "title": "Communications equipment use",
      "description": "National household use of named communications equipment and internet facilities, 2024. A household may use several categories.",
      "query": {
        "fields": [
          "equipment",
          "value"
        ],
        "where": [
          {
            "field": "sector",
            "op": "eq",
            "value": "Sri Lanka"
          },
          {
            "field": "equipment",
            "op": "in",
            "value": [
              "Radio",
              "Television",
              "Fixed-line telephone",
              "Smart mobile phone",
              "Normal mobile phone",
              "Desktop computer",
              "Laptop computer",
              "Tablet computer",
              "Internet facilities"
            ]
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "equipment",
          "label": "Equipment or facility"
        },
        "measure": {
          "field": "value",
          "label": "Household use",
          "unit": "% of households"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "household-vehicle-use",
      "title": "Household vehicle use",
      "description": "Households using bicycles, motorcycles or scooters, and three-wheelers, by census sector, 2024. Use is recorded regardless of ownership.",
      "query": {
        "fields": [
          "equipment",
          "value",
          "sector"
        ],
        "where": [
          {
            "field": "sector",
            "op": "in",
            "value": [
              "Urban",
              "Estate-Urban",
              "Rural",
              "Estate-Rural"
            ]
          },
          {
            "field": "equipment",
            "op": "in",
            "value": [
              "Bicycle",
              "Motorcycle/scooter",
              "Three-wheeler"
            ]
          }
        ],
        "order_by": [
          {
            "field": "equipment",
            "direction": "asc"
          },
          {
            "field": "sector",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "comparison",
        "dimension": {
          "field": "equipment",
          "label": "Vehicle type"
        },
        "measure": {
          "field": "value",
          "label": "Household use",
          "unit": "% of households"
        },
        "series": {
          "field": "sector",
          "label": "Census sector"
        },
        "showLegend": true
      }
    }
  ]
},
{
  "id": "housing-occupancy-tenure",
  "title": "Housing occupancy and tenure",
  "label": "Housing occupancy and tenure",
  "themeIds": [
    "REGI",
    "SOCI"
  ],
  "description": "Occupied and permanently closed or vacant housing by district, and housing tenure by district and census sector.",
  "sourceIds": [
    "dcs-cph-2024-final-report"
  ],
  "vintage": "Census 2012 and 2024 occupancy; Census 2024 tenure, final report tables 11.2 and 11.4",
  "note": {
    "dek": "Occupied and vacant housing, ownership and renting across districts.",
    "question": "How many homes are occupied or vacant, and how is housing held?",
    "contains": "The census final report provides occupied and permanently closed or vacant housing-unit counts for every district in 2012 and 2024. Its 2024 tenure table reports shares owned by a household member, rented or leased from government or private owners, rent-free, encroached, or held under other arrangements. Tenure shares cover districts and four census sectors, plus national totals.",
    "use": "Compare vacant-unit counts across districts, examine occupied-unit growth between censuses, or compare private renting and household-member ownership by district.",
    "limit": "Housing units and households are different populations. Permanently closed and vacant units are one combined source category and do not indicate homes available to rent or buy. Tenure describes occupied housing arrangements, not title verification, mortgage debt, rents or housing affordability. Districts, sectors and national aggregates overlap. Tenure percentages use their own geographic denominators and are rounded; do not add them across geographies. The 2012 district closed/vacant counts sum to 686,510, three more than the printed national total of 686,507; both are retained. No vacancy rate is inferred from the occupied and combined closed/vacant counts."
  },
  "presets": [
    {
      "id": "vacant-units",
      "title": "Permanently closed or vacant housing",
      "description": "Combined permanently closed/vacant housing-unit counts by district, 2024. The source does not separate these two conditions.",
      "query": {
        "fields": [
          "geography",
          "value"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Permanently closed or vacant housing units"
          },
          {
            "field": "year",
            "op": "eq",
            "value": 2024
          },
          {
            "field": "geography_type",
            "op": "eq",
            "value": "district"
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "geography",
          "label": "District"
        },
        "measure": {
          "field": "value",
          "label": "Closed or vacant units",
          "unit": "housing units"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "private-renting",
      "title": "Private renting by district",
      "description": "Share of housing units rented or leased from private owners, 2024. Government renting and rent-free accommodation are separate categories.",
      "query": {
        "fields": [
          "geography",
          "value"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Tenure share"
          },
          {
            "field": "tenure",
            "op": "eq",
            "value": "Rent/lease — privately owned"
          },
          {
            "field": "geography_type",
            "op": "eq",
            "value": "district"
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "geography",
          "label": "District"
        },
        "measure": {
          "field": "value",
          "label": "Private rent or lease",
          "unit": "% of housing units"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "occupied-units",
      "title": "Occupied housing by district",
      "description": "Occupied housing-unit counts in the 2012 and 2024 censuses. Counts are distinct from household totals.",
      "query": {
        "fields": [
          "geography",
          "year",
          "value"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Occupied housing units"
          },
          {
            "field": "geography_type",
            "op": "eq",
            "value": "district"
          }
        ],
        "order_by": [
          {
            "field": "geography",
            "direction": "asc"
          },
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "comparison",
        "dimension": {
          "field": "geography",
          "label": "District"
        },
        "measure": {
          "field": "value",
          "label": "Occupied housing",
          "unit": "housing units"
        },
        "series": {
          "field": "year",
          "label": "Census year"
        },
        "showLegend": true
      }
    }
  ]
},
{
  "id": "electricity-customers-sales",
  "title": "Electricity customers and sales",
  "label": "Electricity customers and sales",
  "themeIds": [
    "ENER",
    "REGI"
  ],
  "description": "CEB and LECO customer accounts and electricity sales, with CEB distribution-area and billed-revenue detail.",
  "sourceIds": [
    "ceb-statistical-digest-2025"
  ],
  "vintage": "2024–2025, CEB Statistical Digest 2025",
  "note": {
    "dek": "Electricity accounts, energy sales and billed revenue by utility area and tariff.",
    "question": "Where are electricity customers, and how does use differ by tariff?",
    "contains": "The 2025 CEB digest reports customer accounts and electricity sales for 2024 and 2025 by CEB distribution province and tariff category. It also reports CEB billed sales revenue and a separate LECO tariff table covering sales and accounts. Source division totals, tariff-group totals and their detailed subcategories are retained as separate observations.",
    "use": "Compare customer accounts across CEB distribution areas, inspect sales in the main tariff groups for each utility, or examine CEB billed revenue within its own geographic or tariff breakdown.",
    "limit": "CEB distribution provinces are utility operating areas, not the nine administrative provinces. Accounts count service accounts, not people, households or electrification rates. CEB totals include bulk supply to LECO; LECO retail sales and accounts are reported separately and must not be added to CEB totals as though they were independent. CEB records one aggregate account each for bulk LECO supply and street lighting. Tariff-group and division totals overlap their detailed rows; geographic and tariff tables also overlap. Revenue is nominal billed sales, not cash collected, and changes reflect tariffs as well as use. Sales are rounded, so components can differ slightly from totals. Street-lighting sales are estimated; undefined dashes remain null."
  },
  "presets": [
    {
      "id": "distribution-accounts",
      "title": "Electricity accounts by utility area",
      "description": "CEB customer accounts by distribution province in 2025. Division totals, bulk supply, street lighting and the grand total are excluded.",
      "query": {
        "fields": [
          "category",
          "value"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Consumer accounts"
          },
          {
            "field": "operator",
            "op": "eq",
            "value": "CEB"
          },
          {
            "field": "breakdown",
            "op": "eq",
            "value": "Distribution province"
          },
          {
            "field": "category_type",
            "op": "eq",
            "value": "distribution area"
          },
          {
            "field": "year",
            "op": "eq",
            "value": 2025
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "category",
          "label": "CEB distribution province"
        },
        "measure": {
          "field": "value",
          "label": "Consumer accounts",
          "unit": "accounts"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "tariff-sales",
      "title": "Electricity sales by tariff",
      "description": "CEB and LECO sales in the main tariff groups, 2025. The utilities serve different areas; bulk supply and subgroup rows are excluded.",
      "query": {
        "fields": [
          "category",
          "operator",
          "value"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Electricity sales"
          },
          {
            "field": "breakdown",
            "op": "eq",
            "value": "Tariff"
          },
          {
            "field": "category",
            "op": "in",
            "value": [
              "Domestic",
              "Religious",
              "General Purpose Total",
              "Hotel Total",
              "Industrial Total",
              "Government Total",
              "Agriculture"
            ]
          },
          {
            "field": "year",
            "op": "eq",
            "value": 2025
          }
        ],
        "order_by": [
          {
            "field": "category",
            "direction": "asc"
          },
          {
            "field": "operator",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "comparison",
        "dimension": {
          "field": "category",
          "label": "Tariff group"
        },
        "measure": {
          "field": "value",
          "label": "Electricity sales",
          "unit": "GWh"
        },
        "series": {
          "field": "operator",
          "label": "Utility"
        },
        "showLegend": true
      }
    },
    {
      "id": "distribution-revenue",
      "title": "Electricity billed revenue by utility area",
      "description": "CEB billed sales revenue by distribution province, 2025, in nominal LKR million. Utility areas are not administrative provinces.",
      "query": {
        "fields": [
          "category",
          "value"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Billed sales revenue"
          },
          {
            "field": "breakdown",
            "op": "eq",
            "value": "Distribution province"
          },
          {
            "field": "category_type",
            "op": "eq",
            "value": "distribution area"
          },
          {
            "field": "year",
            "op": "eq",
            "value": 2025
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "category",
          "label": "CEB distribution province"
        },
        "measure": {
          "field": "value",
          "label": "Billed sales revenue",
          "unit": "LKR million"
        },
        "orientation": "horizontal"
      }
    }
  ]
},
{
  "id": "electricity-supply-reliability",
  "title": "Electricity supply reliability",
  "label": "Electricity supply reliability",
  "themeIds": [
    "ENER",
    "REGI"
  ],
  "description": "Monthly outage duration and frequency indices by electricity licensee, utility province and service area.",
  "sourceIds": [
    "pucsl-reliability-2024-q3",
    "pucsl-reliability-2024-q4",
    "pucsl-reliability-2025-q1",
    "pucsl-reliability-2025-q2",
    "pucsl-reliability-2025-q3",
    "pucsl-reliability-2025-q4",
    "pucsl-reliability-2026-q1"
  ],
  "vintage": "July 2024–March 2026; seven PUCSL quarterly workbooks; conflicting LECO 2025 Q1 periods remain unassigned",
  "note": {
    "dek": "Monthly power-interruption duration and frequency across utility service areas.",
    "question": "How often is power interrupted, and for how long?",
    "contains": "PUCSL’s quarterly workbooks publish monthly System Average Interruption Duration Index (SAIDI) and System Average Interruption Frequency Index (SAIFI) values for CEB’s four distribution divisions and LECO. They include utility-province and service-area detail as well as published division totals. This series covers July 2024 to March 2026. The 2024 Q4 CEB sheets separate interruption causes; their total columns are used here.",
    "use": "Track the published CEB division indices over time, compare verified months within an operating geography, or query utility-area observations. Inspect the unit, reported month, reported year and period-status fields before combining reports.",
    "limit": "SAIDI measures duration per customer and SAIFI interruptions per customer, not total outage minutes or total incidents. The workbooks include planned outages, breakdowns and transmission failures; licensees use different feeder and customer-count assumptions, and some assumptions omit unreported faults or use planned durations. Read the original Assumptions worksheets when comparing areas. Utility geographies differ from administrative boundaries. Provincial and division indices overlap area observations and cannot be summed or averaged without customer weights. Raw numeric cell values, displayed tokens and cached formulas are preserved; formulas are not recalculated. Hasalaka is labelled Proposed and its source zeros do not establish operating reliability. The LECO sheet linked as 2025 Q1 prints 2024 as its duration year and September in a frequency column; all 42 LECO observations from that file remain undated. Its duration unit is hours per customer, while the other duration sections specify minutes. No silent date correction or unit conversion is made."
  },
  "presets": [
    {
      "id": "saidi",
      "title": "Average power-interruption duration",
      "description": "Monthly SAIDI for the four CEB distribution divisions, July 2024–March 2026. Published division indices are retained; no unweighted average of utility areas is calculated.",
      "query": {
        "fields": [
          "period",
          "value",
          "division"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "SAIDI"
          },
          {
            "field": "geography_level",
            "op": "eq",
            "value": "division"
          },
          {
            "field": "division",
            "op": "in",
            "value": [
              "CEB DD1",
              "CEB DD2",
              "CEB DD3",
              "CEB DD4"
            ]
          },
          {
            "field": "period_status",
            "op": "eq",
            "value": "verified"
          },
          {
            "field": "unit",
            "op": "eq",
            "value": "minutes per customer"
          }
        ],
        "order_by": [
          {
            "field": "period",
            "direction": "asc"
          },
          {
            "field": "division",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "period",
          "label": "Month"
        },
        "measure": {
          "field": "value",
          "label": "Average interruption duration",
          "unit": "minutes per customer"
        },
        "series": {
          "field": "division",
          "label": "CEB distribution division"
        },
        "showLegend": true
      }
    },
    {
      "id": "saifi",
      "title": "Average power-interruption frequency",
      "description": "Monthly SAIFI for the four CEB distribution divisions, July 2024–March 2026. Published division indices are retained; no unweighted average of utility areas is calculated.",
      "query": {
        "fields": [
          "period",
          "value",
          "division"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "SAIFI"
          },
          {
            "field": "geography_level",
            "op": "eq",
            "value": "division"
          },
          {
            "field": "division",
            "op": "in",
            "value": [
              "CEB DD1",
              "CEB DD2",
              "CEB DD3",
              "CEB DD4"
            ]
          },
          {
            "field": "period_status",
            "op": "eq",
            "value": "verified"
          },
          {
            "field": "unit",
            "op": "eq",
            "value": "interruptions per customer"
          }
        ],
        "order_by": [
          {
            "field": "period",
            "direction": "asc"
          },
          {
            "field": "division",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "period",
          "label": "Month"
        },
        "measure": {
          "field": "value",
          "label": "Average interruption frequency",
          "unit": "interruptions per customer"
        },
        "series": {
          "field": "division",
          "label": "CEB distribution division"
        },
        "showLegend": true
      }
    },
    {
      "id": "latest-area-duration",
      "title": "Power-interruption duration by service area",
      "description": "Verified March 2026 SAIDI by CEB and LECO service area, in minutes per customer. Proposed areas and overlapping province and division totals are excluded.",
      "query": {
        "fields": [
          "geography_label",
          "value"
        ],
        "where": [
          {
            "field": "period",
            "op": "eq",
            "value": "2026-03"
          },
          {
            "field": "metric",
            "op": "eq",
            "value": "SAIDI"
          },
          {
            "field": "unit",
            "op": "eq",
            "value": "minutes per customer"
          },
          {
            "field": "geography_level",
            "op": "eq",
            "value": "utility area"
          },
          {
            "field": "is_proposed",
            "op": "eq",
            "value": false
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "geography_label",
          "label": "Utility service area"
        },
        "measure": {
          "field": "value",
          "label": "Average interruption duration",
          "unit": "minutes per customer"
        },
        "orientation": "horizontal"
      }
    }
  ]
},
{
  "id": "computer-digital-literacy",
  "title": "Computer and digital literacy",
  "label": "Computer and digital literacy",
  "themeIds": [
    "SOCI",
    "REGI",
    "EDUC",
    "TECH"
  ],
  "description": "Census computer and digital literacy rates by district and residential sector for people aged five and over.",
  "sourceIds": [
    "dcs-cph-2024-final-report"
  ],
  "vintage": "Census 2024, final report tables 7.12–7.13; population aged 5+",
  "note": {
    "dek": "Computer and digital skills among people aged five and over.",
    "question": "How do basic computer and digital skills vary across districts and sectors?",
    "contains": "The 2024 census reports computer and digital literacy rates for all districts, with their populations aged five and over, and for three residential-sector groupings. Computer literacy requires independently turning on a computer and performing a task. Digital literacy includes the ability to perform a task on a computer or smartphone.",
    "use": "Compare the published district rates or examine the gap between computer and digital literacy within each sector. Use the population counts as the published age-eligible denominators, not as counts of literate people.",
    "limit": "The measures concern basic ability, not advanced proficiency, educational attainment, internet access or device ownership. Computer and digital literacy overlap and their rates cannot be added. Rates use the population aged five and over and should not be joined directly to surveys with different age ranges. This table combines urban and estate-urban into one urban grouping; estate-rural is separate. Percentages are rounded to one decimal and should not be averaged across districts without weights. National figures appear in both breakdowns and overlap the component geographies."
  },
  "presets": [
    {
      "id": "digital-literacy-district",
      "title": "Digital literacy by district",
      "description": "Digital literacy among people aged five and over, Census 2024. The definition includes tasks performed on a smartphone or computer.",
      "query": {
        "fields": [
          "geography",
          "value"
        ],
        "where": [
          {
            "field": "geography_type",
            "op": "eq",
            "value": "district"
          },
          {
            "field": "metric",
            "op": "eq",
            "value": "Digital literacy rate"
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "geography",
          "label": "District"
        },
        "measure": {
          "field": "value",
          "label": "Digital literacy rate",
          "unit": "% of people aged 5+"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "literacy-by-sector",
      "title": "Computer and digital literacy by sector",
      "description": "Basic skills rates among people aged five and over, Census 2024. The urban group includes estate-urban; estate-rural remains separate.",
      "query": {
        "fields": [
          "geography",
          "metric",
          "value"
        ],
        "where": [
          {
            "field": "geography_type",
            "op": "eq",
            "value": "sector"
          }
        ],
        "order_by": [
          {
            "field": "geography",
            "direction": "asc"
          },
          {
            "field": "metric",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "comparison",
        "dimension": {
          "field": "geography",
          "label": "Census sector grouping"
        },
        "measure": {
          "field": "value",
          "label": "Literacy rate",
          "unit": "% of people aged 5+"
        },
        "series": {
          "field": "metric",
          "label": "Skill measure"
        },
        "showLegend": true
      }
    }
  ]
},
{
  "id": "language-literacy",
  "title": "Language literacy",
  "label": "Language literacy",
  "themeIds": [
    "SOCI",
    "REGI",
    "EDUC"
  ],
  "description": "Reading-and-writing literacy in Sinhala, Tamil and English by district, age and ethnic group, with recent census benchmarks by sex.",
  "sourceIds": [
    "dcs-cph-2024-final-report"
  ],
  "vintage": "Census 2024 final report tables 7.8–7.11; 2012 and 2024 benchmarks, 2024 district and age detail",
  "note": {
    "dek": "Reading and writing ability in Sinhala, Tamil and English.",
    "question": "How does language literacy vary across districts and age groups?",
    "contains": "The 2024 census final report provides language-literacy rates for people aged ten and over. District data include the eligible population, literacy in at least one of Sinhala, Tamil or English, and separate rates for each language. Age-group detail covers the three named languages. National rates by sex and ethnic-group rates provide 2012 and 2024 census benchmarks.",
    "use": "Compare district literacy rates, examine language differences across age groups, or compare the two recent census benchmarks by sex or ethnic group. Select the source table to avoid duplicate national observations.",
    "limit": "Literacy here means reading and writing a short passage with understanding. It does not measure speaking fluency or literacy in languages outside Sinhala, Tamil and English. A person can be literate in several languages, so language percentages overlap and cannot be added. Rates use people aged ten and over; each age, ethnic and geographic group has its own denominator. Rounded rates cannot be averaged without weights. National observations recur across tables. The historical comparison includes only the 2012 and 2024 benchmarks; intervening years are not estimated, and older censuses in the report are not presented as a continuous comparable series."
  },
  "presets": [
    {
      "id": "district-literacy",
      "title": "Language literacy by district",
      "description": "People aged ten and over able to read and write in at least one of Sinhala, Tamil or English, Census 2024.",
      "query": {
        "fields": [
          "geography",
          "value"
        ],
        "where": [
          {
            "field": "report_table",
            "op": "eq",
            "value": "7.10"
          },
          {
            "field": "geography_type",
            "op": "eq",
            "value": "district"
          },
          {
            "field": "language",
            "op": "eq",
            "value": "At least one language"
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "geography",
          "label": "District"
        },
        "measure": {
          "field": "value",
          "label": "Language literacy rate",
          "unit": "% of people aged 10+"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "recent-census-benchmarks",
      "title": "Language literacy by sex",
      "description": "National census benchmarks for people aged ten and over, 2012 and 2024. Total, male and female rates overlap and are not additive.",
      "query": {
        "fields": [
          "year",
          "sex",
          "value"
        ],
        "where": [
          {
            "field": "report_table",
            "op": "eq",
            "value": "7.8"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "sex",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "comparison",
        "dimension": {
          "field": "year",
          "label": "Census year"
        },
        "measure": {
          "field": "value",
          "label": "Language literacy rate",
          "unit": "% of people aged 10+"
        },
        "series": {
          "field": "sex",
          "label": "Sex"
        },
        "showLegend": true
      }
    },
    {
      "id": "age-language-literacy",
      "title": "Language literacy by age",
      "description": "Literacy in Sinhala, Tamil and English within each age group, Census 2024. Language rates overlap.",
      "query": {
        "fields": [
          "age_group",
          "language",
          "value"
        ],
        "where": [
          {
            "field": "report_table",
            "op": "eq",
            "value": "7.9"
          },
          {
            "field": "age_group",
            "op": "in",
            "value": [
              "10-14",
              "15-19",
              "20-29",
              "30-39",
              "40-49",
              "50-59",
              "60 and above"
            ]
          }
        ],
        "order_by": [
          {
            "field": "age_group",
            "direction": "asc"
          },
          {
            "field": "language",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "comparison",
        "dimension": {
          "field": "age_group",
          "label": "Age group"
        },
        "measure": {
          "field": "value",
          "label": "Language literacy rate",
          "unit": "% of people aged 10+"
        },
        "series": {
          "field": "language",
          "label": "Language"
        },
        "showLegend": true
      }
    }
  ]
},
{
  "id": "functional-difficulties-disability",
  "title": "Functional difficulties and disability",
  "label": "Functional difficulties and disability",
  "themeIds": [
    "SOCI",
    "REGI",
    "HEAL"
  ],
  "description": "Census counts and prevalence rates for functional difficulties and the disability threshold by district.",
  "sourceIds": [
    "dcs-cph-2024-final-report"
  ],
  "vintage": "Census 2024 final report tables 6.2.2 and 6.2.6; population aged 5+",
  "note": {
    "dek": "Functional-difficulty and disability prevalence across all districts.",
    "question": "Where are functional difficulties and accessibility needs most prevalent?",
    "contains": "The 2024 census reports counts and rates per 1,000 people aged five and over for seeing, hearing, walking or climbing steps, remembering or concentrating, self-care and communicating. Each district has two separate thresholds: any reported difficulty, and the Washington Group disability threshold of a lot of difficulty or cannot do at all. The tables also provide people with at least one affected domain and their age-eligible population denominators.",
    "use": "Compare district prevalence using one threshold at a time, inspect the functional domains relevant to service accessibility, or compare counts with the published age-eligible population. Retain the stricter disability threshold when that is the population of interest.",
    "limit": "Any difficulty includes some difficulty and is broader than the disability threshold. The two populations overlap and must not be added. A person can report several affected domains; domain counts and rates are not additive. Rates use people aged five and over and are per 1,000, not percentages. Published rates are rounded whole numbers and are not replaced by rates recalculated from the counts. These are census functional-ability responses, not clinical diagnoses, measures of environmental accessibility or counts of people needing a particular service. National totals overlap district counts."
  },
  "presets": [
    {
      "id": "disability-prevalence",
      "title": "Disability prevalence by district",
      "description": "People aged five and over reporting a lot of difficulty or cannot do at all in at least one domain, per 1,000 people aged five and over, Census 2024.",
      "query": {
        "fields": [
          "geography",
          "value"
        ],
        "where": [
          {
            "field": "threshold",
            "op": "eq",
            "value": "Disability threshold"
          },
          {
            "field": "metric",
            "op": "eq",
            "value": "Prevalence rate"
          },
          {
            "field": "domain",
            "op": "eq",
            "value": "At least one domain"
          },
          {
            "field": "geography_type",
            "op": "eq",
            "value": "district"
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "geography",
          "label": "District"
        },
        "measure": {
          "field": "value",
          "label": "Disability prevalence",
          "unit": "per 1,000 people aged 5+"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "disability-domains",
      "title": "Disability by functional domain",
      "description": "National counts meeting the disability threshold in each domain, Census 2024. People with several affected domains appear in more than one category.",
      "query": {
        "fields": [
          "domain",
          "value"
        ],
        "where": [
          {
            "field": "threshold",
            "op": "eq",
            "value": "Disability threshold"
          },
          {
            "field": "metric",
            "op": "eq",
            "value": "People with difficulty"
          },
          {
            "field": "domain",
            "op": "in",
            "value": [
              "Seeing",
              "Hearing",
              "Walking or climbing steps",
              "Remembering or concentrating",
              "Self-care",
              "Communicating"
            ]
          },
          {
            "field": "geography_type",
            "op": "eq",
            "value": "country"
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "domain",
          "label": "Functional domain"
        },
        "measure": {
          "field": "value",
          "label": "People meeting disability threshold",
          "unit": "people"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "difficulty-thresholds",
      "title": "Functional-difficulty thresholds by district",
      "description": "Broader any-difficulty and stricter disability-threshold prevalence, Census 2024. These are overlapping populations, each measured per 1,000 people aged five and over.",
      "query": {
        "fields": [
          "geography",
          "threshold",
          "value"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Prevalence rate"
          },
          {
            "field": "domain",
            "op": "eq",
            "value": "At least one domain"
          },
          {
            "field": "geography_type",
            "op": "eq",
            "value": "district"
          }
        ],
        "order_by": [
          {
            "field": "geography",
            "direction": "asc"
          },
          {
            "field": "threshold",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "comparison",
        "dimension": {
          "field": "geography",
          "label": "District"
        },
        "measure": {
          "field": "value",
          "label": "Prevalence",
          "unit": "per 1,000 people aged 5+"
        },
        "series": {
          "field": "threshold",
          "label": "Response threshold"
        },
        "showLegend": true
      }
    }
  ]
},
{
  "id": "housing-condition-materials",
  "title": "Housing condition and materials",
  "label": "Housing condition and materials",
  "themeIds": [
    "REGI",
    "SOCI"
  ],
  "description": "Occupied-housing condition, construction materials, room counts and construction-period profiles from Census 2024.",
  "sourceIds": [
    "dcs-cph-2024-final-report"
  ],
  "vintage": "Census 2024 final report tables 11.3 and 11.6–11.8",
  "note": {
    "dek": "Housing materials, permanent and improvised units, and one-room homes.",
    "question": "How does the housing stock differ in materials, condition and available rooms?",
    "contains": "The census classifies occupied housing as permanent, semi-permanent, improvised or not classified using wall, roof and floor materials. Counts and shares cover every district and the report’s sector groups. National tables also describe wall, roof and floor materials and construction periods. A separate sector table records one-room and multi-room housing.",
    "use": "Compare semi-permanent housing shares by district, examine roofing materials, or compare one-room housing across sectors. Construction-period counts describe the surviving census housing stock in each period, rather than annual construction output.",
    "limit": "Material-based condition does not certify structural safety, building-code compliance or maintenance quality. Room counts are not bedroom counts or an overcrowding measure. Construction-period totals exclude container boxes and other units, giving 6,029,330 units rather than the 6,030,541 in the condition and room tables. Construction periods have unequal lengths and cannot be compared as annual building rates. The condition table combines urban and estate-urban; the room table separates them. Wall, roof and floor distributions are separate, overlapping views of the same units. Counts, shares and overlapping totals must not be added together; printed percentages, including 0.0, retain rounding."
  },
  "presets": [
    {
      "id": "semi-permanent-housing",
      "title": "Semi-permanent housing by district",
      "description": "Occupied units classified as semi-permanent from construction materials, Census 2024. This is a material-based census classification.",
      "query": {
        "fields": [
          "geography",
          "value"
        ],
        "where": [
          {
            "field": "characteristic",
            "op": "eq",
            "value": "Material-based condition"
          },
          {
            "field": "category",
            "op": "eq",
            "value": "Semi-permanent"
          },
          {
            "field": "metric",
            "op": "eq",
            "value": "Housing share"
          },
          {
            "field": "geography_type",
            "op": "eq",
            "value": "district"
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "geography",
          "label": "District"
        },
        "measure": {
          "field": "value",
          "label": "Semi-permanent units",
          "unit": "% of housing units"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "one-room-housing",
      "title": "One-room housing by sector",
      "description": "Share of occupied housing with only one room, Census 2024. Urban and estate-urban are separate in this table.",
      "query": {
        "fields": [
          "geography",
          "value"
        ],
        "where": [
          {
            "field": "characteristic",
            "op": "eq",
            "value": "Room count"
          },
          {
            "field": "category",
            "op": "eq",
            "value": "One room"
          },
          {
            "field": "metric",
            "op": "eq",
            "value": "Housing share"
          },
          {
            "field": "geography_type",
            "op": "eq",
            "value": "sector"
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "geography",
          "label": "Census sector"
        },
        "measure": {
          "field": "value",
          "label": "One-room units",
          "unit": "% of housing units"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "roof-materials",
      "title": "Housing roof materials",
      "description": "National shares of occupied housing by roof material, Census 2024. The material categories retain the census labels.",
      "query": {
        "fields": [
          "category",
          "value"
        ],
        "where": [
          {
            "field": "characteristic",
            "op": "eq",
            "value": "Building material"
          },
          {
            "field": "building_part",
            "op": "eq",
            "value": "Roof"
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "category",
          "label": "Roof material"
        },
        "measure": {
          "field": "value",
          "label": "Housing share",
          "unit": "% of housing units"
        },
        "orientation": "horizontal"
      }
    }
  ]
},
{
  "id": "weather-station-observations",
  "title": "Weather station observations",
  "label": "Weather station observations",
  "themeIds": [
    "ENVI",
    "REGI"
  ],
  "description": "Reported temperature, day/night relative humidity and rainfall at 24 meteorological stations in 2025.",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "vintage": "2025 station observations, DCS Pocket Book 2026 table 1.3",
  "note": {
    "dek": "Temperature, relative humidity and rainfall at meteorological stations.",
    "question": "How did reported weather conditions vary between stations in 2025?",
    "contains": "The Department of Meteorology figures reproduced in the Pocket Book report average temperature, average day and night relative humidity, and rainfall for 24 observation stations in 2025. Temperature is in degrees Celsius, humidity in percent and rainfall in millimetres. Nine night-humidity cells are unreported.",
    "use": "Compare the reported 2025 rainfall or average temperatures across stations. Use humidity observations only where the source supplies a value and keep day and night measures separate.",
    "limit": "These are station observations for one year, not district averages, a nationwide spatial surface, a weather forecast or a long-term climate normal. Station names alone do not establish instrument coordinates or catchment boundaries. Do not sum temperatures or humidity, or treat rainfall at several stations as a national total. Blank night-humidity cells remain unavailable. The Badulla temperature is 23.9 °C in the rendered table; a stray 29.0 in the PDF text layer is excluded after visual review."
  },
  "presets": [
    {
      "id": "station-rainfall",
      "title": "Rainfall by observation station",
      "description": "Reported rainfall in 2025 at 24 meteorological stations, in millimetres. These are point observations rather than district averages.",
      "query": {
        "fields": [
          "station",
          "value"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Rainfall"
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "station",
          "label": "Observation station"
        },
        "measure": {
          "field": "value",
          "label": "Rainfall",
          "unit": "mm"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "station-temperature",
      "title": "Average temperature by observation station",
      "description": "Reported average temperature in 2025, in degrees Celsius. The table describes one year of observations.",
      "query": {
        "fields": [
          "station",
          "value"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Average temperature"
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "station",
          "label": "Observation station"
        },
        "measure": {
          "field": "value",
          "label": "Average temperature",
          "unit": "°C"
        },
        "orientation": "horizontal"
      }
    }
  ]
},
{
  "id": "administrative-units-district",
  "title": "Administrative units by district",
  "label": "Administrative units",
  "themeIds": [
    "REGI",
    "GOVE"
  ],
  "description": "Reported divisional secretariats, GN divisions, councils and electorates by district at 19 December 2025.",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "vintage": "As at 19 December 2025, Pocket Book 2026 table 1.4",
  "note": {
    "dek": "Counts of divisional secretariats, GN divisions and local authorities.",
    "question": "How are administrative units and councils distributed across districts?",
    "contains": "The Pocket Book records DS/AGA divisions, Grama Niladhari divisions, Pradeshiya Sabhas, Municipal Councils, Urban Councils and the source’s electorate category for all 25 districts and Sri Lanka. The table is explicitly dated 19 December 2025 and retains its special counting notes.",
    "use": "Compare reported administrative-unit counts across districts or inspect the distribution of local authority types at the stated date. Use the footnotes when matching these counts to a boundary file or an earlier council dataset.",
    "limit": "Counts do not provide boundaries, membership lists, service capacity or population coverage. Different unit types describe overlapping administrative systems and cannot be added as a single count. Batticaloa’s 346 GN divisions are a statistical count; the source says there are 345 territorial divisions. Matale’s 532 GN divisions reflect reservoir-related removals. Ampara’s DS/AGA figure includes the Kalmunai North sub-secretariat. The table reflects five council upgrades in 2023, giving 29 Municipal Councils and 36 Urban Councils nationally; this differs from the classifications in some earlier financial returns. A source dash retains nil-or-negligible status and is not made into a numerical zero."
  },
  "presets": [
    {
      "id": "gn-divisions",
      "title": "GN divisions by district",
      "description": "Reported gn divisions by district, as at 19 December 2025. The national total is excluded.",
      "query": {
        "fields": [
          "geography",
          "value"
        ],
        "where": [
          {
            "field": "division_type",
            "op": "eq",
            "value": "GN divisions"
          },
          {
            "field": "geography_type",
            "op": "eq",
            "value": "district"
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "geography",
          "label": "District"
        },
        "measure": {
          "field": "value",
          "label": "GN divisions",
          "unit": "divisions"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "divisional-secretariats",
      "title": "Divisional secretariats by district",
      "description": "Reported ds/aga divisions by district, as at 19 December 2025. The national total is excluded.",
      "query": {
        "fields": [
          "geography",
          "value"
        ],
        "where": [
          {
            "field": "division_type",
            "op": "eq",
            "value": "DS/AGA divisions"
          },
          {
            "field": "geography_type",
            "op": "eq",
            "value": "district"
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "geography",
          "label": "District"
        },
        "measure": {
          "field": "value",
          "label": "DS/AGA divisions",
          "unit": "divisions"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "local-authorities",
      "title": "Local authorities by district",
      "description": "Pradeshiya Sabhas, Municipal Councils and Urban Councils as at 19 December 2025. Council types are compared separately.",
      "query": {
        "fields": [
          "geography",
          "division_type",
          "value"
        ],
        "where": [
          {
            "field": "geography_type",
            "op": "eq",
            "value": "district"
          },
          {
            "field": "division_type",
            "op": "in",
            "value": [
              "Pradeshiya Sabhas",
              "Municipal Councils",
              "Urban Councils"
            ]
          }
        ],
        "order_by": [
          {
            "field": "geography",
            "direction": "asc"
          },
          {
            "field": "division_type",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "comparison",
        "dimension": {
          "field": "geography",
          "label": "District"
        },
        "measure": {
          "field": "value",
          "label": "Local authorities",
          "unit": "councils"
        },
        "series": {
          "field": "division_type",
          "label": "Council type"
        },
        "showLegend": true
      }
    }
  ]
},
{
  "id": "bank-branches-density",
  "title": "Bank branches and banking density",
  "label": "Banking access",
  "themeIds": [
    "REGI",
    "ECON"
  ],
  "description": "District banking outlets and population-based density, with the national branch-network history.",
  "sourceIds": [
    "cbsl-ess-2026-bank-7-8",
    "cbsl-ess-2026-bank-7-9"
  ],
  "vintage": "Districts 2022–2025; national network 2013–2025; CBSL Economic and Social Statistics 2026 tables 7.8–7.9",
  "note": {
    "dek": "Banking outlets across districts and the national branch-network history.",
    "question": "How does the availability of banking outlets vary across districts?",
    "contains": "Central Bank tables report district banking outlets by institution, total branches, population in thousands, people per branch and branches per 100,000 people for 2022–2025. The national network table extends to 2013 and separates commercial banks, specialised banks and co-operative rural banks. Revised and provisional flags, displayed values and cached spreadsheet formulas are retained.",
    "use": "Compare the latest district banking-density figures, examine district outlet counts, or track the national licensed-bank network using its own historical table. Select the source table and branch scope before comparing totals.",
    "limit": "The source counts all banking outlets except Student Savings Units; these are not necessarily full-service branches. Density uses total population, not adults, account ownership, travel time or digital-banking access. Population is reported in thousands and the source’s density formulas use those denominators; they are not replaced with census counts. District and national tables overlap. Their 2022 licensed-bank totals differ: 3,632 in table 7.8 and 3,630 in table 7.9; both remain separate. Rural-inclusive totals in 2013–2018, 2020 and 2021 also differ from licensed-plus-rural counts; the affected observations have individual review notes. Subtotals, individual banks and rural-bank-inclusive totals overlap and must not be added together. Bank names retain source wording; DFCC’s 2015 amalgamation and the 2019 Lankaputhra merger affect historical institution comparisons. Blank cells remain unavailable, while printed numeric zeros remain zero. Cached formulas are preserved without recalculation. The 2025 figures are provisional."
  },
  "presets": [
    {
      "id": "district-banking-density",
      "title": "Banking density by district",
      "description": "Licensed-bank outlets per 100,000 people, 2025 provisional, CBSL table 7.8. Density uses total population and the source’s outlet definition.",
      "query": {
        "fields": [
          "geography",
          "value"
        ],
        "where": [
          {
            "field": "report_table",
            "op": "eq",
            "value": "7.8"
          },
          {
            "field": "year",
            "op": "eq",
            "value": 2025
          },
          {
            "field": "metric",
            "op": "eq",
            "value": "Banking density"
          },
          {
            "field": "geography_type",
            "op": "eq",
            "value": "district"
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "geography",
          "label": "District"
        },
        "measure": {
          "field": "value",
          "label": "Banking density",
          "unit": "branches per 100,000 people"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "national-branch-history",
      "title": "National bank branch network",
      "description": "Licensed-bank outlets, 2013–2025, CBSL table 7.9. Co-operative rural banks are excluded; 2025 is provisional.",
      "query": {
        "fields": [
          "year",
          "value"
        ],
        "where": [
          {
            "field": "report_table",
            "op": "eq",
            "value": "7.9"
          },
          {
            "field": "metric",
            "op": "eq",
            "value": "Bank branches"
          },
          {
            "field": "bank",
            "op": "eq",
            "value": "All licensed banks"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Licensed-bank outlets",
          "unit": "branches"
        }
      }
    },
    {
      "id": "district-bank-outlets",
      "title": "Banking outlets by district",
      "description": "Total licensed-bank outlets by district, 2025 provisional, CBSL table 7.8. The national total and individual institution columns are excluded.",
      "query": {
        "fields": [
          "geography",
          "value"
        ],
        "where": [
          {
            "field": "report_table",
            "op": "eq",
            "value": "7.8"
          },
          {
            "field": "year",
            "op": "eq",
            "value": 2025
          },
          {
            "field": "metric",
            "op": "eq",
            "value": "Bank branches"
          },
          {
            "field": "bank",
            "op": "eq",
            "value": "All licensed banks"
          },
          {
            "field": "geography_type",
            "op": "eq",
            "value": "district"
          }
        ],
        "order_by": [
          {
            "field": "value",
            "direction": "desc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "geography",
          "label": "District"
        },
        "measure": {
          "field": "value",
          "label": "Banking outlets",
          "unit": "branches"
        },
        "orientation": "horizontal"
      }
    }
  ]
},
{
  "id": "vital-statistics",
  "title": "Vital statistics",
  "label": "Vital statistics",
  "description": "Population, birth and death rates, and maternal and child mortality measures reported by the Registrar General.",
  "vintage": "2018–2025, Pocket Book 2026 table 2.7",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "themeIds": [
    "SOCI",
    "REGI",
    "HEAL"
  ],
  "note": {
    "dek": "Birth, death and mortality rates, with the population estimates used in the source.",
    "question": "How have birth, death and child mortality rates changed?",
    "contains": "Eight annual observations for each of six national measures: estimated mid-year population, crude birth and death rates, maternal mortality, under-five mortality and infant mortality. The Registrar General figures are reproduced in DCS table 2.7. Population is in thousands; rate denominators are retained separately. The source marks 2018–2021 revised and 2022–2025 provisional.",
    "use": "Compare birth and death rates on the same population denominator. Examine infant and under-five mortality where reported, and use the separate maternal mortality measure with its own denominator.",
    "limit": "Fourteen mortality cells are unavailable and remain null; missing rates do not mean no deaths. Maternal mortality is per 100,000 live births, child mortality per 1,000 live births, and birth/death rates per 1,000 population. These denominators cannot be interchanged. The source warns that estimated mid-year population can differ from census counts. From 2009, civil-registration maternal mortality information is reviewed and supplemented using Family Health Bureau data. This table provides national figures only."
  },
  "presets": [
    {
      "id": "birth-death",
      "title": "Birth and death rates",
      "description": "National rates per 1,000 population, 2018–2025. Later years are provisional.",
      "query": {
        "fields": [
          "year",
          "value",
          "metric"
        ],
        "where": [
          {
            "field": "metric",
            "op": "in",
            "value": [
              "Birth rate",
              "Death rate"
            ]
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "metric",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Reported value",
          "unit": "per 1,000 people"
        },
        "series": {
          "field": "metric",
          "label": "metric"
        },
        "showLegend": true
      }
    },
    {
      "id": "child-mortality",
      "title": "Infant and under-five mortality",
      "description": "Reported national mortality rates per 1,000 live births. Missing years remain unavailable.",
      "query": {
        "fields": [
          "year",
          "value",
          "metric"
        ],
        "where": [
          {
            "field": "metric",
            "op": "in",
            "value": [
              "Under-five mortality rate",
              "Infant mortality rate"
            ]
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "metric",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Reported value",
          "unit": "per 1,000 live births"
        },
        "series": {
          "field": "metric",
          "label": "metric"
        },
        "showLegend": true
      }
    },
    {
      "id": "maternal-mortality",
      "title": "Maternal mortality",
      "description": "Reported maternal mortality per 100,000 live births, with gaps retained.",
      "query": {
        "fields": [
          "year",
          "value"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Maternal mortality rate"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Reported value",
          "unit": "per 100,000 live births"
        }
      }
    }
  ]
},
{
  "id": "paddy-irrigation",
  "title": "Paddy irrigation",
  "label": "Paddy irrigation",
  "description": "Irrigable paddy land and cultivated area under major and minor irrigation schemes.",
  "vintage": "2017–2025, Pocket Book 2026 table 6.2",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "themeIds": [
    "ECON",
    "ENVI",
    "REGI",
    "AGRI"
  ],
  "note": {
    "dek": "Paddy land and seasonal cultivation under major and minor irrigation schemes.",
    "question": "How much paddy land is irrigable, and how much is cultivated under each scheme?",
    "contains": "Annual national hectares for major and minor irrigation schemes, 2017–2025. DCS distinguishes irrigable area, the asweddumized extent during the year, from irrigated area, the extent cultivated across both seasons in the cultivation year.",
    "use": "Compare physical irrigable paddy area between major and minor schemes, or follow the separately reported cultivated area over time.",
    "limit": "Irrigated area counts cultivation in both seasons and can exceed the physical irrigable land area. Dividing these measures does not give a simple share of land served by irrigation. The table does not provide district detail, water volumes, infrastructure condition, crop yield or a separate rainfed category. The substantial changes in major/minor scheme figures in 2025 are reproduced as printed; this table does not explain whether classification or coverage changed."
  },
  "presets": [
    {
      "id": "irrigable",
      "title": "Irrigable paddy area",
      "description": "Physical asweddumized extent under major and minor schemes, in hectares.",
      "query": {
        "fields": [
          "year",
          "value",
          "scheme"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Irrigable area"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "scheme",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Reported value",
          "unit": "hectares"
        },
        "series": {
          "field": "scheme",
          "label": "scheme"
        },
        "showLegend": true
      }
    },
    {
      "id": "irrigated",
      "title": "Paddy cultivation under irrigation",
      "description": "Cultivated extent across both seasons of the cultivation year, in hectares.",
      "query": {
        "fields": [
          "year",
          "value",
          "scheme"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Irrigated area"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "scheme",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Reported value",
          "unit": "hectares"
        },
        "series": {
          "field": "scheme",
          "label": "scheme"
        },
        "showLegend": true
      }
    }
  ]
},
{
  "id": "tourism-activity",
  "title": "Tourism activity",
  "label": "Tourism activity",
  "description": "Tourist arrivals, nights, employment, establishments, receipts and purposes of visit.",
  "vintage": "2016–2025 national trends, 2022–2025 establishment figures and 2017–2025 visit purposes, Pocket Book 2026",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "themeIds": [
    "ECON",
    "SOCI",
    "INTR"
  ],
  "note": {
    "dek": "Tourist arrivals, overnight stays, industry employment and purposes of visit.",
    "question": "How has tourism activity changed, and which parts of the industry employ people?",
    "contains": "SLTDA figures reproduced in DCS tables 14.1–14.3: ten years of national arrivals, tourist nights, receipts and direct/indirect employment; establishments and employment by category for 2022–2025; and the purpose-of-visit distribution for 2017–2025. Currency and thousand-night units are retained. Indirect employment is explicitly identified as estimated, separately from provisional source flags.",
    "use": "Follow arrivals or tourist nights, compare direct and estimated indirect employment, or inspect visit purposes and establishment categories. Keep the national trend and category totals as separate representations of the same employment figures.",
    "limit": "Tourist nights are in thousands. Receipt currencies are alternative valuations, not amounts to add together, and the table does not document a constant-price adjustment. Indirect employment is estimated. Most 2025 establishment-category details are unavailable even though a total is reported; missing details and guide-establishment counts remain null. Dashes in earlier religious/cultural purpose shares mean nil or negligible rather than an exact zero. The source does not establish whether changing purpose shares reflect survey or classification changes. These are national figures, not district tourism exposure or accommodation room capacity. Annual receipts overlap the separate monthly tourism-earnings dataset and should not be added to it. In 2023, the published direct-employment total is 204,591 while its establishment categories sum to 204,501, a difference of 90 people. Both are retained without adjustment."
  },
  "presets": [
    {
      "id": "arrivals",
      "title": "Tourist arrivals",
      "description": "Annual tourist arrivals, 2016–2025.",
      "query": {
        "fields": [
          "year",
          "value"
        ],
        "where": [
          {
            "field": "table_scope",
            "op": "eq",
            "value": "National trends"
          },
          {
            "field": "metric",
            "op": "eq",
            "value": "Tourist arrivals"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Reported value",
          "unit": "arrivals"
        }
      }
    },
    {
      "id": "employment",
      "title": "Tourism employment",
      "description": "Direct employment and estimated indirect employment, with provisional cells retained.",
      "query": {
        "fields": [
          "year",
          "value",
          "metric"
        ],
        "where": [
          {
            "field": "table_scope",
            "op": "eq",
            "value": "National trends"
          },
          {
            "field": "metric",
            "op": "in",
            "value": [
              "Direct employment",
              "Indirect employment"
            ]
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "metric",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Reported value",
          "unit": "people"
        },
        "series": {
          "field": "metric",
          "label": "metric"
        },
        "showLegend": true
      }
    },
    {
      "id": "purpose",
      "title": "Purpose of tourist visits",
      "description": "Published percentage shares by purpose, 2017–2025. Nil/negligible religious/cultural shares remain unavailable as exact numbers.",
      "query": {
        "fields": [
          "year",
          "value",
          "category"
        ],
        "where": [
          {
            "field": "table_scope",
            "op": "eq",
            "value": "Visit purpose"
          },
          {
            "field": "category",
            "op": "in",
            "value": ["Pleasure", "Business", "Visiting friends and relations", "Religious and cultural", "Other"]
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "category",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Reported value",
          "unit": "%"
        },
        "series": {
          "field": "category",
          "label": "category"
        },
        "showLegend": true
      }
    }
  ]
},
{
  "id": "vocational-training",
  "title": "Vocational training",
  "label": "Vocational training",
  "description": "Student intake, completions, institutions, staff and finances in the vocational and technical training sector.",
  "vintage": "2024–2025, Pocket Book 2026 tables 13.6–13.8",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "themeIds": [
    "SOCI",
    "ECON",
    "EDUC"
  ],
  "note": {
    "dek": "Students, training centres, courses, staff and finances by vocational institution.",
    "question": "How much vocational training capacity is reported across institutions?",
    "contains": "Figures for eleven vocational and technical training institutions or institutional groups in 2024 and 2025. The tables cover student intake, completions and departures; government grants, fees and other income, capital and recurrent expenditure; and centres, courses, academic and non-academic employees. CGTTI course modes and the separate NAITA special industrial/on-the-job row are retained. Finance and institutional-capacity figures for 2025 are provisional.",
    "use": "Compare institutional intake, centres, staff or financial measures using the same definition and year. Inspect CGTTI full-time and part-time training separately from its total.",
    "limit": "Annual intake, completion and departure counts are not a matched cohort; their ratios cannot establish completion or dropout rates. The special NAITA row may overlap its main institutional row, and CGTTI course modes sum to its total, so do not add all programme rows. Printing Institute completions in 2025 are incomplete because results for 447 students were unreleased. Missing financial and capacity cells remain unavailable; a printed 0.00 government grant is retained as zero. Currency amounts are nominal LKR million, not cost per student. The source does not provide campus locations, course duration, qualification levels or graduate employment outcomes. The university-degree table is outside this dataset."
  },
  "presets": [
    {
      "id": "intake",
      "title": "Vocational student intake",
      "description": "2025 student intake by institution; NAITA uses its main row, and programme subrows are excluded.",
      "query": {
        "fields": [
          "institution",
          "value"
        ],
        "where": [
          {
            "field": "year",
            "op": "eq",
            "value": 2025
          },
          {
            "field": "metric",
            "op": "eq",
            "value": "Student intake"
          },
          {
            "field": "programme",
            "op": "in",
            "value": [
              "All reported programmes",
              "Main institutional row"
            ]
          }
        ],
        "order_by": [
          {
            "field": "institution",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "institution",
          "label": "Institution"
        },
        "measure": {
          "field": "value",
          "label": "Reported count",
          "unit": "students"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "centres",
      "title": "Vocational training centres",
      "description": "Reported centres in 2025; missing Printing Institute coverage remains unavailable.",
      "query": {
        "fields": [
          "institution",
          "value"
        ],
        "where": [
          {
            "field": "year",
            "op": "eq",
            "value": 2025
          },
          {
            "field": "metric",
            "op": "eq",
            "value": "Centres"
          },
          {
            "field": "programme",
            "op": "eq",
            "value": "All reported programmes"
          }
        ],
        "order_by": [
          {
            "field": "institution",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "institution",
          "label": "Institution"
        },
        "measure": {
          "field": "value",
          "label": "Reported count",
          "unit": "centres"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "staff",
      "title": "Vocational training staff",
      "description": "Academic and non-academic employees by institution in 2025.",
      "query": {
        "fields": [
          "institution",
          "value",
          "metric"
        ],
        "where": [
          {
            "field": "year",
            "op": "eq",
            "value": 2025
          },
          {
            "field": "metric",
            "op": "in",
            "value": [
              "Academic employees",
              "Non-academic employees"
            ]
          },
          {
            "field": "programme",
            "op": "eq",
            "value": "All reported programmes"
          }
        ],
        "order_by": [
          {
            "field": "institution",
            "direction": "asc"
          },
          {
            "field": "metric",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "institution",
          "label": "Institution"
        },
        "measure": {
          "field": "value",
          "label": "Reported count",
          "unit": "people"
        },
        "orientation": "horizontal",
        "series": {
          "field": "metric",
          "label": "metric"
        },
        "showLegend": true
      }
    }
  ]
},
{
  "id": "school-examination-results",
  "title": "School examination results",
  "label": "School examination results",
  "description": "Candidate counts and qualification rates for GCE Ordinary Level and Advanced Level examinations.",
  "vintage": "2024–2025 examination years, Pocket Book 2026 table 13.2",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "themeIds": [
    "SOCI",
    "REGI",
    "EDUC"
  ],
  "note": {
    "dek": "GCE O/L and A/L participation and qualification results for school and all candidates.",
    "question": "How many candidates sat the examinations, and what share qualified for the next stage?",
    "contains": "Department of Examinations figures for 2024 and 2025. O/L records candidates who sat at least five subjects and the percentage qualifying for A/L. A/L records candidates who sat, the number qualifying for university and their qualification percentage, with an additional applied count for all candidates. School candidates and all candidates remain separate populations.",
    "use": "Compare qualification rates between examination years within the same candidate group. Distinguish applications from attendance, and qualification from subsequent enrolment.",
    "limit": "All candidates includes school candidates; the two groups must not be added. O/L attendance covers candidates sitting five or more subjects. University qualification is examination eligibility, not an offer, admission or enrolment. The source labels examination years without specifying actual sitting dates or tracking individual cohorts. Annual O/L and A/L counts do not form a student transition series, and two reported years do not establish a long-term trend. Results are national, with no district or school detail."
  },
  "presets": [
    {
      "id": "ol-qualification",
      "title": "O/L candidates qualifying for A/L",
      "description": "Published percentage among the reported O/L candidate populations, 2024–2025.",
      "query": {
        "fields": [
          "year",
          "value",
          "candidate_group"
        ],
        "where": [
          {
            "field": "examination",
            "op": "eq",
            "value": "GCE O/L"
          },
          {
            "field": "metric",
            "op": "eq",
            "value": "Qualified for A/L"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "candidate_group",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Reported value",
          "unit": "%"
        },
        "series": {
          "field": "candidate_group",
          "label": "candidate group"
        },
        "showLegend": true
      }
    },
    {
      "id": "al-qualification",
      "title": "A/L candidates qualifying for university",
      "description": "Examination eligibility among candidates who sat A/L; this is not an admission rate.",
      "query": {
        "fields": [
          "year",
          "value",
          "candidate_group"
        ],
        "where": [
          {
            "field": "examination",
            "op": "eq",
            "value": "GCE A/L"
          },
          {
            "field": "metric",
            "op": "eq",
            "value": "University qualification rate"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "candidate_group",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Reported value",
          "unit": "%"
        },
        "series": {
          "field": "candidate_group",
          "label": "candidate group"
        },
        "showLegend": true
      }
    }
  ]
},
{
  "id": "gdp-expenditure",
  "title": "GDP by expenditure",
  "label": "GDP by expenditure",
  "description": "Current-price GDP, consumption, investment and external balance, with published shares of GDP.",
  "vintage": "2021–2025; national accounts base 2015, current prices; Pocket Book 2026 table 10.4",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "themeIds": [
    "ECON"
  ],
  "note": {
    "dek": "Consumption, investment and trade in the expenditure measure of GDP.",
    "question": "How much of nominal GDP comes from consumption, capital formation and net exports?",
    "contains": "DCS expenditure-side national accounts for 2021–2025, at current prices within the 2015-base national-accounts framework. Thirteen reported items include consumption and its components, gross capital formation and its components, exports, imports, the external balance and GDP at market prices. Each has a nominal value in LKR million and a published percentage of GDP. The source marks 2023–2024 revised and 2025 provisional.",
    "use": "Compare nominal component values or the reported shares of consumption, capital formation and the external balance. Keep component levels separate from percentage shares.",
    "limit": "Current prices mean nominal amounts; the 2015 national-accounts base does not make these inflation-adjusted values or a 2015=100 index. Parentheses denote negative external balances and shares. Consumption and capital totals overlap their subcomponents, while the external balance already subtracts imports from exports; summing every row double-counts GDP. Small differences between displayed component sums and totals are retained as published rounding. The table is national and cannot establish district output, real growth or household welfare."
  },
  "presets": [
    {
      "id": "demand-shares",
      "title": "Expenditure components as a share of GDP",
      "description": "Final consumption, gross capital formation and the external balance, using the published GDP shares.",
      "query": {
        "fields": [
          "year",
          "value",
          "component"
        ],
        "where": [
          {
            "field": "measure",
            "op": "eq",
            "value": "GDP share"
          },
          {
            "field": "component",
            "op": "in",
            "value": [
              "Final consumption expenditure",
              "Gross capital formation",
              "External balance of goods and services"
            ]
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "component",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Reported value",
          "unit": "% of GDP"
        },
        "series": {
          "field": "component",
          "label": "component"
        },
        "showLegend": true
      }
    },
    {
      "id": "investment",
      "title": "Gross capital formation",
      "description": "Nominal capital formation and gross fixed capital formation, in LKR million. The fixed component is included in the total.",
      "query": {
        "fields": [
          "year",
          "value",
          "component"
        ],
        "where": [
          {
            "field": "measure",
            "op": "eq",
            "value": "Nominal value"
          },
          {
            "field": "component",
            "op": "in",
            "value": [
              "Gross capital formation",
              "Gross fixed capital formation"
            ]
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "component",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Reported value",
          "unit": "LKR million"
        },
        "series": {
          "field": "component",
          "label": "component"
        },
        "showLegend": true
      }
    },
    {
      "id": "external-balance",
      "title": "External balance of goods and services",
      "description": "Exports less imports at current prices; negative values are retained from accounting parentheses.",
      "query": {
        "fields": [
          "year",
          "value"
        ],
        "where": [
          {
            "field": "measure",
            "op": "eq",
            "value": "Nominal value"
          },
          {
            "field": "component",
            "op": "eq",
            "value": "External balance of goods and services"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Reported value",
          "unit": "LKR million"
        }
      }
    }
  ]
},
{
  "id": "external-trade-indices",
  "title": "External trade indices",
  "label": "External trade indices",
  "description": "Import and export value and volume indices, with terms of trade on the published 2010 base.",
  "vintage": "2021–2025, base 2010=100, Pocket Book 2026 table 9.8",
  "sourceIds": [
    "dcs-pocketbook-2026"
  ],
  "themeIds": [
    "ECON",
    "INTR"
  ],
  "note": {
    "dek": "Import and export value, volume and terms-of-trade indices.",
    "question": "How have trade values and volumes moved relative to the 2010 base?",
    "contains": "Five annual CBSL index series for 2021–2025 reproduced in DCS table 9.8: import and export value indices, import and export volume indices, and terms of trade. The published base is 2010=100. The source defines terms of trade as the export unit-price index divided by the import unit-price index, multiplied by 100.",
    "use": "Compare import and export movements within the value or volume index family. Follow terms of trade separately to assess relative export and import unit-price movements.",
    "limit": "Index values are neither rupee trade amounts nor physical tonnes. A value index combines price and volume effects; a volume index is a separate measure, and the two should not be added. Terms of trade below 100 refer to relative unit prices against the base and do not establish a trade deficit or declining trade volume. The excerpt does not give commodity weights, detailed coverage or seasonal adjustment. Published indices are rounded, so recomputing terms of trade from them can differ slightly from the reported figure. These national indices should not be joined to another base without a documented link."
  },
  "presets": [
    {
      "id": "value",
      "title": "Import and export value indices",
      "description": "Published value indices, 2021–2025; base 2010=100.",
      "query": {
        "fields": [
          "year",
          "value",
          "trade_flow"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Value index"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "trade_flow",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Reported value",
          "unit": "2010=100"
        },
        "series": {
          "field": "trade_flow",
          "label": "trade flow"
        },
        "showLegend": true
      }
    },
    {
      "id": "volume",
      "title": "Import and export volume indices",
      "description": "Published volume indices, 2021–2025; base 2010=100.",
      "query": {
        "fields": [
          "year",
          "value",
          "trade_flow"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Volume index"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "trade_flow",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Reported value",
          "unit": "2010=100"
        },
        "series": {
          "field": "trade_flow",
          "label": "trade flow"
        },
        "showLegend": true
      }
    },
    {
      "id": "terms",
      "title": "Terms of trade",
      "description": "Export unit prices relative to import unit prices on the published index base.",
      "query": {
        "fields": [
          "year",
          "value"
        ],
        "where": [
          {
            "field": "metric",
            "op": "eq",
            "value": "Terms of trade"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Reported value",
          "unit": "2010=100"
        }
      }
    }
  ]
},
{
  "id": "public-transport-capacity",
  "title": "Public transport capacity",
  "label": "Public transport capacity",
  "themeIds": [
    "TRAN",
    "REGI"
  ],
  "description": "Bus fleets, seating capacity and routes, with railway rolling stock and operational availability.",
  "sourceIds": [
    "ntc-statistics-2024"
  ],
  "vintage": "SLTB 2018–2023, inter-provincial private buses 2015–2023 and provincial/rail 2023, National Transport Statistics 2024",
  "note": {
    "dek": "Bus fleets, routes, seats and railway rolling stock from the national transport report.",
    "question": "How much bus and rail capacity is reported, and how much of the bus fleet operates?",
    "contains": "NTC National Transport Statistics 2024 tables 5.8, 6.1, 6.2, 6.4 and 7.4. SLTB records annual average fleet, timetable requirement, daily available buses and daily operated buses for 2018–2023. Private-bus data cover inter-provincial service classes for 2015–2023, provincial fleets and seats in 2023, and route counts. Rail figures separate maintainable stock from stock in service in 2023.",
    "use": "Compare SLTB operating availability over time, inspect private-bus capacity by province or service type, and distinguish railway stock in service from maintainable stock. Keep table scope and transport operators in filters.",
    "limit": "SLTB measures are averages; the private-bus table does not establish an equivalent daily averaging basis. Do not add them as though they measured the same operational count. Table 6.1 reports 3,151 inter-provincial private buses in 2023 while table 6.2 reports 3,152; both remain in separate table scopes with notes. Fleet includes operated and inactive vehicles, and routes are counts rather than route geometry, frequency, coverage or passenger accessibility. Rail dash cells have no defined legend and remain null with source-ambiguity status; they do not mean Sri Lanka has no passenger coaches or wagons. Maintainable and in-service rail stock overlap. Reported seats, bus counts and routes have different units. The report is a 2024 edition with observations ending in 2023; it does not establish current capacity. Suspect scheduled-distance, passenger-flow and rail-track rows elsewhere in the report are outside this import."
  },
  "presets": [
    {
      "id": "sltb",
      "title": "SLTB fleet and daily operation",
      "description": "Annual average fleet, timetable requirement and daily bus availability/operation, 2018–2023.",
      "query": {
        "fields": [
          "year",
          "value",
          "metric"
        ],
        "where": [
          {
            "field": "table_scope",
            "op": "eq",
            "value": "SLTB operational averages"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "metric",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Reported value",
          "unit": "buses"
        },
        "series": {
          "field": "metric",
          "label": "metric"
        },
        "showLegend": true
      }
    },
    {
      "id": "private-inter",
      "title": "Inter-provincial private bus fleet and operation",
      "description": "Table 6.1 fleet and operated buses, 2015–2023; the conflicting table 6.2 fleet is kept separate.",
      "query": {
        "fields": [
          "year",
          "value",
          "metric"
        ],
        "where": [
          {
            "field": "table_scope",
            "op": "eq",
            "value": "Inter-provincial service history"
          },
          {
            "field": "service_type",
            "op": "eq",
            "value": "All services"
          }
        ],
        "order_by": [
          {
            "field": "year",
            "direction": "asc"
          },
          {
            "field": "metric",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "trend",
        "dimension": {
          "field": "year",
          "label": "Year"
        },
        "measure": {
          "field": "value",
          "label": "Reported value",
          "unit": "buses"
        },
        "series": {
          "field": "metric",
          "label": "metric"
        },
        "showLegend": true
      }
    },
    {
      "id": "provincial-operation",
      "title": "Private buses operated by province",
      "description": "Reported intra-provincial buses operated in 2023; this table does not define a comparable daily-average basis to SLTB.",
      "query": {
        "fields": [
          "geography",
          "value"
        ],
        "where": [
          {
            "field": "table_scope",
            "op": "eq",
            "value": "Private bus provincial capacity"
          },
          {
            "field": "geography_type",
            "op": "eq",
            "value": "province"
          },
          {
            "field": "metric",
            "op": "eq",
            "value": "Buses operated"
          }
        ],
        "order_by": [
          {
            "field": "geography",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "geography",
          "label": "geography"
        },
        "measure": {
          "field": "value",
          "label": "Reported count",
          "unit": "buses"
        },
        "orientation": "horizontal"
      }
    },
    {
      "id": "rail-stock",
      "title": "Railway rolling stock",
      "description": "Maintainable and in-service stock in 2023. The two statuses overlap; undefined dash cells remain unavailable.",
      "query": {
        "fields": [
          "vehicle_type",
          "value",
          "metric"
        ],
        "where": [
          {
            "field": "table_scope",
            "op": "eq",
            "value": "Rail rolling stock"
          }
        ],
        "order_by": [
          {
            "field": "vehicle_type",
            "direction": "asc"
          },
          {
            "field": "metric",
            "direction": "asc"
          }
        ],
        "limit": 200
      },
      "chart": {
        "family": "ranking",
        "dimension": {
          "field": "vehicle_type",
          "label": "vehicle type"
        },
        "measure": {
          "field": "value",
          "label": "Reported count",
          "unit": "vehicles"
        },
        "orientation": "horizontal",
        "series": {
          "field": "metric",
          "label": "metric"
        },
        "showLegend": true
      }
    }
  ]
}
]
