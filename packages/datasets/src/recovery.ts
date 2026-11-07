import type { IndicatorDatasetDefinition } from './presets'

/** Reviewed SLDU and original-source histories; each preset selects an honest slice. */
export const RECOVERY_DATASETS: readonly IndicatorDatasetDefinition[] = [
  {
    "id": "worldbank-economic-outlook",
    "title": "Economic indicators and forecasts",
    "label": "Economic outlook",
    "themeIds": [
      "ECON"
    ],
    "description": "World Bank estimates and forecasts for GDP, inflation, public finances and external accounts.",
    "sourceIds": [
      "worldbank-sldu-2026-10",
      "worldbank-sldu-2026-05",
      "worldbank-sldu-2025-10",
      "worldbank-sldu-2025-04",
      "worldbank-sldu-2024-10",
      "worldbank-sldu-2024-04",
      "worldbank-sldu-2023-10",
      "worldbank-sldu-2023-04",
      "worldbank-sldu-2022-10",
      "worldbank-sldu-2021-04"
    ],
    "vintage": "SLDU editions April 2021–October 2026; reported years 2018–2028",
    "note": {
      "dek": "World Bank estimates and forecasts for GDP, inflation, public finances and external accounts.",
      "question": "How have World Bank forecasts and estimates of Sri Lanka’s economy changed?",
      "contains": "Annual economic indicators from ten Sri Lanka Development Updates published between April 2021 and October 2026. The tables cover 2018–2028, including forecasts. Each figure identifies its report, unit and estimate or forecast status.",
      "use": "Compare the October 2026 GDP growth outlook with estimates in earlier reports. Other measures include consumption, investment, trade, government revenue, expenditure, debt and reserves.",
      "limit": "Coverage is limited to the selected economic tables. Definitions and historical figures can change between reports. Expenditure estimates and forecasts are labelled separately from reported history."
    },
    "presets": [
      {
        "id": "gdp-outlook",
        "title": "Real GDP growth",
        "description": "Annual real GDP growth from the October 2026 World Bank report. Figures for 2026–2028 are forecasts.",
        "query": {
          "fields": [
            "year",
            "value",
            "observation_status"
          ],
          "where": [
            {
              "field": "edition",
              "op": "eq",
              "value": "2026-10"
            },
            {
              "field": "metric",
              "op": "eq",
              "value": "real_gdp_growth"
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
            "label": "Real GDP growth",
            "unit": "% annual change"
          },
          "series": {
            "field": "observation_status",
            "label": "Estimate or forecast"
          },
          "showLegend": true
        }
      },
      {
        "id": "gdp-vintages",
        "title": "GDP growth estimates by report",
        "description": "World Bank GDP growth estimates and forecasts, with one line for each report published between April 2021 and October 2026.",
        "query": {
          "fields": [
            "year",
            "value",
            "edition"
          ],
          "where": [
            {
              "field": "metric",
              "op": "eq",
              "value": "real_gdp_growth"
            }
          ],
          "order_by": [
            {
              "field": "year",
              "direction": "asc"
            },
            {
              "field": "edition",
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
            "label": "Real GDP growth",
            "unit": "% annual change"
          },
          "series": {
            "field": "edition",
            "label": "Report edition"
          },
          "showLegend": true
        }
      }
    ]
  },
  {
    "id": "worldbank-poverty-estimates",
    "title": "Poverty estimates and forecasts",
    "label": "Poverty estimates",
    "themeIds": [
      "SOCI",
      "ECON"
    ],
    "description": "National poverty rates estimated by the World Bank, with forecasts and comparisons between reports.",
    "sourceIds": [
      "worldbank-sldu-2026-10",
      "worldbank-sldu-2026-05",
      "worldbank-sldu-2025-10",
      "worldbank-sldu-2025-04",
      "worldbank-sldu-2024-10",
      "worldbank-sldu-2023-10",
      "worldbank-sldu-2022-10",
      "worldbank-sldu-2021-04"
    ],
    "vintage": "SLDU editions April 2021–October 2026; reported years 2018–2028",
    "note": {
      "dek": "National poverty rates estimated by the World Bank, with forecasts and comparisons between reports.",
      "question": "How has modelled poverty changed, and what does each forecast edition say?",
      "contains": "Poverty headcount rates from eight Sri Lanka Development Updates published between April 2021 and October 2026. Each figure identifies the report, year, daily poverty threshold, purchasing power parity (PPP) base and estimation method.",
      "use": "The main chart shows the October 2026 estimates for 2022–2025 and forecasts for 2026–2028, at USD 4.20 a day in 2021 PPP prices. Other charts compare reports using the same threshold and PPP base.",
      "limit": "The 2011, 2017 and 2021 PPP thresholds define different poverty lines and cannot be joined into one series. The October 2026 report also revises the estimation method. These are national modelled estimates, separate from official district household-survey results. The latest table has no observations before 2022."
    },
    "presets": [
      {
        "id": "poverty-outlook",
        "title": "National poverty rate",
        "description": "Share of people below USD 4.20 a day in 2021 purchasing-power-parity prices. The October 2026 World Bank report estimates 2022–2025 and forecasts 2026–2028.",
        "query": {
          "fields": [
            "year",
            "value",
            "observation_status"
          ],
          "where": [
            {
              "field": "edition",
              "op": "eq",
              "value": "2026-10"
            },
            {
              "field": "poverty_line_usd_day",
              "op": "eq",
              "value": 4.2
            },
            {
              "field": "ppp_year",
              "op": "eq",
              "value": 2021
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
            "label": "Poverty headcount",
            "unit": "% population"
          },
          "series": {
            "field": "observation_status",
            "label": "Estimate or forecast"
          },
          "showLegend": true
        }
      },
      {
        "id": "poverty-vintages-2017",
        "title": "Poverty estimates (2017 PPP)",
        "description": "Share of people below USD 3.65 a day in 2017 purchasing-power-parity prices. Each line shows the estimates and forecasts in one World Bank report.",
        "query": {
          "fields": [
            "year",
            "value",
            "edition"
          ],
          "where": [
            {
              "field": "poverty_line_usd_day",
              "op": "eq",
              "value": 3.65
            },
            {
              "field": "ppp_year",
              "op": "eq",
              "value": 2017
            }
          ],
          "order_by": [
            {
              "field": "year",
              "direction": "asc"
            },
            {
              "field": "edition",
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
            "label": "Poverty headcount",
            "unit": "% population"
          },
          "series": {
            "field": "edition",
            "label": "Report edition"
          },
          "showLegend": true
        }
      },
      {
        "id": "poverty-vintages-2021",
        "title": "Poverty estimates (2021 PPP)",
        "description": "Share of people below USD 4.20 a day in 2021 purchasing-power-parity prices. Each line shows one World Bank report; October 2026 uses a revised estimation method.",
        "query": {
          "fields": [
            "year",
            "value",
            "edition"
          ],
          "where": [
            {
              "field": "poverty_line_usd_day",
              "op": "eq",
              "value": 4.2
            },
            {
              "field": "ppp_year",
              "op": "eq",
              "value": 2021
            }
          ],
          "order_by": [
            {
              "field": "year",
              "direction": "asc"
            },
            {
              "field": "edition",
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
            "label": "Poverty headcount",
            "unit": "% population"
          },
          "series": {
            "field": "edition",
            "label": "Report edition"
          },
          "showLegend": true
        }
      }
    ]
  },
  {
    "id": "worldbank-poverty-province",
    "title": "Provincial poverty estimates",
    "label": "Provincial poverty",
    "themeIds": [
      "SOCI",
      "REGI",
      "ECON"
    ],
    "description": "World Bank poverty estimates for Sri Lanka’s nine provinces in 2024.",
    "sourceIds": [
      "worldbank-sldu-2026-10"
    ],
    "vintage": "2024 estimates, October 2026 edition",
    "note": {
      "dek": "World Bank poverty estimates for Sri Lanka’s nine provinces in 2024.",
      "question": "How did estimated poverty vary across provinces in 2024?",
      "contains": "The estimated share of people below USD 4.20 a day in 2021 PPP prices, by province. Figures come from the October 2026 Sri Lanka Development Update and use labour-survey imputation.",
      "use": "Compare poverty rates across provinces for 2024. The figures are the whole-percentage labels on the report’s province map.",
      "limit": "These are rounded, modelled estimates for one year. They do not provide district estimates or a provincial time series, and they differ from official household-survey poverty statistics."
    },
    "presets": [
      {
        "id": "province-poverty",
        "title": "Poverty rate by province",
        "description": "Estimated poverty in 2024 at USD 4.20 a day in 2021 PPP prices. Figures are rounded to whole percentages in the October 2026 World Bank report.",
        "query": {
          "fields": [
            "province",
            "value"
          ],
          "where": [],
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
            "field": "province",
            "label": "Province"
          },
          "measure": {
            "field": "value",
            "label": "Estimated poverty",
            "unit": "% population"
          },
          "orientation": "horizontal"
        }
      }
    ]
  },
  {
    "id": "labour-force-sex-history",
    "title": "Labour force by sex",
    "label": "Labour force by sex",
    "themeIds": [
      "SOCI",
      "ECON"
    ],
    "description": "Annual and quarterly labour-force participation, employment and unemployment by sex.",
    "sourceIds": [
      "dcs-lfs-2025-q2",
      "dcs-lfs-2026-q1",
      "dcs-lfs-2025-q4",
      "dcs-lfs-2019-q4",
      "dcs-lfs-2020-q4",
      "dcs-lfs-2021-q4",
      "dcs-lfs-2022-q4",
      "dcs-lfs-2024-q4",
      "dcs-lfs-2023-q4"
    ],
    "vintage": "Annual 2013–2025 and available quarterly comparisons through Q1 2026; nine report vintages",
    "note": {
      "dek": "Annual and quarterly labour-force participation, employment and unemployment by sex.",
      "question": "How do labour participation and unemployment differ by sex over time?",
      "contains": "National survey estimates for people aged 15 and above, including population, labour force, employment, unemployment and people outside the labour force. Annual figures cover 2013–2025; available quarters extend through Q1 2026. Figures from nine reports are listed separately so revisions can be compared.",
      "use": "Compare annual participation and quarterly unemployment for men, women and both sexes. Charts use the most recent available report for each period. The 2026 Q1 report revises 2025 estimates using Census 2024 population weights.",
      "limit": "Annual averages and quarterly estimates cover different periods. Estimates are subject to sampling and rounding uncertainty. The Census 2024 weighting revision affects comparisons involving 2025; it has not been applied to all earlier quarters."
    },
    "presets": [
      {
        "id": "annual-participation",
        "title": "Labour-force participation by sex",
        "description": "Annual share of people aged 15 and above in the labour force, 2013–2025. The 2025 figures use revised Census 2024 population weights.",
        "query": {
          "fields": [
            "period",
            "participation_pct",
            "sex"
          ],
          "where": [
            {
              "field": "frequency",
              "op": "eq",
              "value": "annual"
            },
            {
              "field": "is_latest_revision",
              "op": "eq",
              "value": true
            }
          ],
          "order_by": [
            {
              "field": "period",
              "direction": "asc"
            }
          ],
          "limit": 200
        },
        "chart": {
          "family": "trend",
          "dimension": {
            "field": "period",
            "label": "Year or quarter"
          },
          "measure": {
            "field": "participation_pct",
            "label": "Participation",
            "unit": "% population aged 15+"
          },
          "series": {
            "field": "sex",
            "label": "Sex"
          },
          "showLegend": true
        }
      },
      {
        "id": "quarterly-unemployment",
        "title": "Quarterly unemployment by sex",
        "description": "Unemployed people as a share of the labour force in the available quarters. The 2026 report revises 2025 estimates using Census 2024 weights.",
        "query": {
          "fields": [
            "period",
            "unemployment_pct",
            "sex"
          ],
          "where": [
            {
              "field": "frequency",
              "op": "eq",
              "value": "quarterly"
            },
            {
              "field": "is_latest_revision",
              "op": "eq",
              "value": true
            }
          ],
          "order_by": [
            {
              "field": "period",
              "direction": "asc"
            }
          ],
          "limit": 200
        },
        "chart": {
          "family": "trend",
          "dimension": {
            "field": "period",
            "label": "Year or quarter"
          },
          "measure": {
            "field": "unemployment_pct",
            "label": "Unemployment",
            "unit": "% labour force"
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
    "id": "labour-employment-profile-history",
    "title": "Employment by age, education and work status",
    "label": "Employment composition",
    "themeIds": [
      "SOCI",
      "ECON"
    ],
    "description": "Employment and unemployment shares by age, education and sex, with employed people also grouped by work status.",
    "sourceIds": [
      "dcs-lfs-2025-q2",
      "dcs-lfs-2026-q1",
      "dcs-lfs-2025-q4",
      "dcs-lfs-2019-q4",
      "dcs-lfs-2020-q4",
      "dcs-lfs-2021-q4",
      "dcs-lfs-2022-q4",
      "dcs-lfs-2024-q4",
      "dcs-lfs-2023-q4"
    ],
    "vintage": "Annual 2013–2025 and available quarterly comparisons through Q1 2026; nine report vintages",
    "note": {
      "dek": "Employment and unemployment shares by age, education and sex, with employed people also grouped by work status.",
      "question": "How does the composition of employment and unemployment change?",
      "contains": "Selected tables from nine Labour Force Survey reports. They show the age and education of employed and unemployed people, and the shares of employees, employers, own-account workers and contributing family workers among employed people. Annual and quarterly figures are listed separately.",
      "use": "Compare the characteristics of employed and unemployed people. The chart shows own-account workers as a share of employed people, by sex. Each period uses its most recent available report.",
      "limit": "The age or education composition of unemployed people is not an unemployment rate for that group. Public and private employees are subsets of all employees. Rounded totals can be 100.1%. Only selected survey tables are included. Asterisks flag high sampling variability where extracted; shaded caution cells have not been fully recorded, so a blank flag does not establish reliability. Quarters with unresolved date labels are excluded from the charts."
    },
    "presets": [
      {
        "id": "own-account-employment",
        "title": "Own-account employment by sex",
        "description": "Own-account workers as a share of employed people, using annual survey estimates.",
        "query": {
          "fields": [
            "period",
            "value",
            "sex"
          ],
          "where": [
            {
              "field": "frequency",
              "op": "eq",
              "value": "annual"
            },
            {
              "field": "is_latest_revision",
              "op": "eq",
              "value": true
            },
            {
              "field": "population_group",
              "op": "eq",
              "value": "Employed"
            },
            {
              "field": "breakdown",
              "op": "eq",
              "value": "Employment status"
            },
            {
              "field": "category",
              "op": "eq",
              "value": "Own-account worker"
            }
          ],
          "order_by": [
            {
              "field": "period",
              "direction": "asc"
            }
          ],
          "limit": 200
        },
        "chart": {
          "family": "trend",
          "dimension": {
            "field": "period",
            "label": "Year or quarter"
          },
          "measure": {
            "field": "value",
            "label": "Share of employed people",
            "unit": "%"
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
    "id": "ncpi-monthly",
    "title": "National Consumer Price Index",
    "label": "National consumer prices",
    "themeIds": [
      "ECON"
    ],
    "description": "Monthly national consumer price indices and inflation rates for all items, food and nonfood.",
    "sourceIds": [
      "dcs-ncpi-food-nonfood"
    ],
    "vintage": "January 2022–August 2026, base 2021=100",
    "note": {
      "dek": "Monthly national consumer price indices and inflation rates for all items, food and nonfood.",
      "question": "How have national food and nonfood prices changed?",
      "contains": "NCPI indices at base 2021=100, from January 2022 to August 2026. The table includes published month-on-month, year-on-year and annual-average inflation rates.",
      "use": "Compare food and nonfood prices on the same index base, or view their year-on-year inflation rates.",
      "limit": "NCPI covers the country; the Colombo Consumer Price Index covers a different population. Unpublished inflation rates remain blank. Earlier index bases and annual summary rows are excluded."
    },
    "presets": [
      {
        "id": "price-index",
        "title": "Consumer price indices",
        "description": "National all-items, food and nonfood indices, January 2022–August 2026. Base: 2021=100.",
        "query": {
          "fields": [
            "period",
            "index_value",
            "group"
          ],
          "where": [],
          "order_by": [
            {
              "field": "period",
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
            "field": "index_value",
            "label": "Price index",
            "unit": "2021=100"
          },
          "series": {
            "field": "group",
            "label": "Price group"
          },
          "showLegend": true
        }
      },
      {
        "id": "price-inflation",
        "title": "Year-on-year consumer price inflation",
        "description": "Year-on-year change in national all-items, food and nonfood prices. Unpublished rates remain blank.",
        "query": {
          "fields": [
            "period",
            "year_on_year_pct",
            "group"
          ],
          "where": [],
          "order_by": [
            {
              "field": "period",
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
            "field": "year_on_year_pct",
            "label": "Year-on-year inflation",
            "unit": "%"
          },
          "series": {
            "field": "group",
            "label": "Price group"
          },
          "showLegend": true
        }
      }
    ]
  },
  {
    "id": "child-nutrition-annual",
    "title": "Child nutrition",
    "label": "Child nutrition",
    "themeIds": [
      "HEAL",
      "SOCI"
    ],
    "description": "Underweight, stunting, wasting and overweight among children under five assessed during Nutrition Month.",
    "sourceIds": [
      "fhb-statistics",
      "fhb-home"
    ],
    "vintage": "Nutrition Month 2016–2025, available indicators",
    "note": {
      "dek": "Underweight, stunting, wasting and overweight among children under five assessed during Nutrition Month.",
      "question": "What do Nutrition Month assessments show about under-five nutrition?",
      "contains": "Family Health Bureau Nutrition Month results for 2016–2025. The available measures include underweight, stunting, wasting, moderate wasting, severe wasting and overweight. Results for 2016–2024 come from the statistics tables; 2025 results come from the bureau’s homepage.",
      "use": "Compare the annual underweight and wasting percentages. Check each indicator’s available years before making other comparisons.",
      "limit": "These are Nutrition Month administrative assessments, not a representative household survey. Assessment coverage and denominators can vary. Moderate and severe wasting are parts of total wasting, so adding them to the total would double-count children. Some indicators are missing in some years."
    },
    "presets": [
      {
        "id": "underweight-history",
        "title": "Child underweight",
        "description": "Percentage of children under five assessed as underweight during Nutrition Month, 2016–2025.",
        "query": {
          "fields": [
            "year",
            "value"
          ],
          "where": [
            {
              "field": "indicator",
              "op": "eq",
              "value": "Underweight"
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
            "label": "Underweight",
            "unit": "% children assessed"
          }
        }
      },
      {
        "id": "wasting-history",
        "title": "Child wasting",
        "description": "Percentage of children under five assessed as wasted during Nutrition Month, 2016–2025.",
        "query": {
          "fields": [
            "year",
            "value"
          ],
          "where": [
            {
              "field": "indicator",
              "op": "eq",
              "value": "Wasting"
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
            "label": "Wasting",
            "unit": "% children assessed"
          }
        }
      }
    ]
  },
  {
    "id": "agricultural-production-index",
    "title": "Agricultural production index",
    "label": "Agricultural production",
    "themeIds": [
      "AGRI",
      "ECON"
    ],
    "description": "Annual agricultural production volume indices for ten crop and product groups.",
    "sourceIds": [
      "dcs-agricultural-volume-index"
    ],
    "vintage": "2014–2025, base 2002=100",
    "note": {
      "dek": "Annual agricultural production volume indices for ten crop and product groups.",
      "question": "How has agricultural production volume changed?",
      "contains": "DCS volume indices for 2014–2025, at base 2002=100. The table includes ten crop and product groups and the overall agricultural production index.",
      "use": "Track the overall production index or compare individual crop and product groups.",
      "limit": "The figures are indices, not tonnes or hectares. Group indices and the overall index cannot be added together."
    },
    "presets": [
      {
        "id": "overall-volume",
        "title": "Agricultural production index",
        "description": "Overall agricultural production volume, 2014–2025. Base: 2002=100.",
        "query": {
          "fields": [
            "year",
            "value"
          ],
          "where": [
            {
              "field": "crop",
              "op": "eq",
              "value": "OVERALL INDEX"
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
            "label": "Production volume index",
            "unit": "2002=100"
          }
        }
      }
    ]
  },
  {
    "id": "paddy-sown-area-history",
    "title": "Paddy sown area",
    "label": "Paddy sown area",
    "themeIds": [
      "AGRI",
      "REGI"
    ],
    "description": "Paddy sown area in hectares, by district and Maha or Yala season, from 1979.",
    "sourceIds": [
      "dcs-paddy-sown-maha",
      "dcs-paddy-sown-yala"
    ],
    "vintage": "Historical seasonal workbooks, 1979 onward; latest year varies by measure",
    "note": {
      "dek": "Paddy sown area in hectares, by district and Maha or Yala season, from 1979.",
      "question": "How has seasonal paddy sown area changed since 1979?",
      "contains": "DCS seasonal paddy statistics, including district figures, national totals and separately reported scheme areas. Maha figures extend to 2025/26; Yala figures extend to 2025. Years refer to the end of the cultivation season.",
      "use": "Compare national Maha and Yala trends, or select a district or scheme area. Figures use the total across irrigation categories.",
      "limit": "Districts, scheme areas and national totals overlap and cannot all be added together. The source changes how Mahaweli and Udawalawe areas are included in district figures after 2017/18. Original geography names are kept, and source dashes mean missing data. Irrigation-specific breakdowns are not included."
    },
    "presets": [
      {
        "id": "national-season-history",
        "title": "Paddy sown area by season",
        "description": "National Maha and Yala figures from 1979, shown by season end year. Maha extends to 2025/26; Yala to 2025.",
        "query": {
          "fields": [
            "year",
            "value",
            "season"
          ],
          "where": [
            {
              "field": "geography",
              "op": "eq",
              "value": "SRI LANKA"
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
            "label": "Sown area",
            "unit": "hectares"
          },
          "series": {
            "field": "season",
            "label": "Cultivation season"
          },
          "showLegend": true
        }
      }
    ]
  },
  {
    "id": "paddy-harvested-area-history",
    "title": "Paddy harvested area",
    "label": "Paddy harvested area",
    "themeIds": [
      "AGRI",
      "REGI"
    ],
    "description": "Paddy harvested area in hectares, by district and Maha or Yala season, from 1979.",
    "sourceIds": [
      "dcs-paddy-harvested-maha",
      "dcs-paddy-harvested-yala"
    ],
    "vintage": "Historical seasonal workbooks, 1979 onward; latest year varies by measure",
    "note": {
      "dek": "Paddy harvested area in hectares, by district and Maha or Yala season, from 1979.",
      "question": "How has seasonal paddy harvested area changed since 1979?",
      "contains": "DCS seasonal paddy statistics, including district figures, national totals and separately reported scheme areas. Maha figures extend to 2025/26; Yala figures extend to 2025. Years refer to the end of the cultivation season.",
      "use": "Compare national Maha and Yala trends, or select a district or scheme area. Figures use the total across irrigation categories.",
      "limit": "Districts, scheme areas and national totals overlap and cannot all be added together. The source changes how Mahaweli and Udawalawe areas are included in district figures after 2017/18. Original geography names are kept, and source dashes mean missing data. Irrigation-specific breakdowns are not included."
    },
    "presets": [
      {
        "id": "national-season-history",
        "title": "Paddy harvested area by season",
        "description": "National Maha and Yala figures from 1979, shown by season end year. Maha extends to 2025/26; Yala to 2025.",
        "query": {
          "fields": [
            "year",
            "value",
            "season"
          ],
          "where": [
            {
              "field": "geography",
              "op": "eq",
              "value": "SRI LANKA"
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
            "label": "Harvested area",
            "unit": "hectares"
          },
          "series": {
            "field": "season",
            "label": "Cultivation season"
          },
          "showLegend": true
        }
      }
    ]
  },
  {
    "id": "paddy-yield-history",
    "title": "Paddy yield",
    "label": "Paddy yield",
    "themeIds": [
      "AGRI",
      "REGI"
    ],
    "description": "Paddy yield in kilograms per hectare, by district and Maha or Yala season, from 1979.",
    "sourceIds": [
      "dcs-paddy-yield-maha",
      "dcs-paddy-yield-yala"
    ],
    "vintage": "Historical seasonal workbooks, 1979 onward; latest year varies by measure",
    "note": {
      "dek": "Paddy yield in kilograms per hectare, by district and Maha or Yala season, from 1979.",
      "question": "How has seasonal paddy yield changed since 1979?",
      "contains": "DCS seasonal paddy statistics, including district figures, national totals and separately reported scheme areas. Maha figures extend to 2025/26; Yala figures extend to 2025. Years refer to the end of the cultivation season.",
      "use": "Compare national Maha and Yala trends, or select a district or scheme area. Figures use the total across irrigation categories.",
      "limit": "Districts, scheme areas and national totals overlap and cannot all be added together. The source changes how Mahaweli and Udawalawe areas are included in district figures after 2017/18. Original geography names are kept, and source dashes mean missing data. Irrigation-specific breakdowns are not included."
    },
    "presets": [
      {
        "id": "national-season-history",
        "title": "Paddy yield by season",
        "description": "National Maha and Yala figures from 1979, shown by season end year. Maha extends to 2025/26; Yala to 2025.",
        "query": {
          "fields": [
            "year",
            "value",
            "season"
          ],
          "where": [
            {
              "field": "geography",
              "op": "eq",
              "value": "SRI LANKA"
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
            "label": "Yield",
            "unit": "kg/hectare"
          },
          "series": {
            "field": "season",
            "label": "Cultivation season"
          },
          "showLegend": true
        }
      }
    ]
  },
  {
    "id": "paddy-production-history",
    "title": "Paddy production",
    "label": "Paddy production",
    "themeIds": [
      "AGRI",
      "REGI"
    ],
    "description": "Paddy production in thousand tonnes, by district and Maha or Yala season, from 1979.",
    "sourceIds": [
      "dcs-paddy-production-maha",
      "dcs-paddy-production-yala"
    ],
    "vintage": "Historical seasonal workbooks, 1979 onward; latest year varies by measure",
    "note": {
      "dek": "Paddy production in thousand tonnes, by district and Maha or Yala season, from 1979.",
      "question": "How has seasonal paddy production changed since 1979?",
      "contains": "DCS seasonal paddy statistics, including district figures, national totals and separately reported scheme areas. Maha figures extend to 2024/25; Yala figures extend to 2025. Years refer to the end of the cultivation season.",
      "use": "Compare national Maha and Yala trends, or select a district or scheme area. Figures use the total across irrigation categories.",
      "limit": "Districts, scheme areas and national totals overlap and cannot all be added together. The source changes how Mahaweli and Udawalawe areas are included in district figures after 2017/18. Original geography names are kept, and source dashes mean missing data. Irrigation-specific breakdowns are not included."
    },
    "presets": [
      {
        "id": "national-season-history",
        "title": "Paddy production by season",
        "description": "National Maha and Yala figures from 1979, shown by season end year. Maha extends to 2024/25; Yala to 2025.",
        "query": {
          "fields": [
            "year",
            "value",
            "season"
          ],
          "where": [
            {
              "field": "geography",
              "op": "eq",
              "value": "SRI LANKA"
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
            "unit": "thousand tonnes"
          },
          "series": {
            "field": "season",
            "label": "Cultivation season"
          },
          "showLegend": true
        }
      }
    ]
  }
]
