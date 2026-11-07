import Explorer from './Explorer.astro'
import Figure from './Figure.astro'
import Guess from './Guess.astro'
import Hero from './Hero.astro'
import LiveView from './LiveView.astro'
import Scrolly from './Scrolly.astro'
import Stat from './Stat.astro'
import Stats from './Stats.astro'

export { Explorer, Figure, Guess, Hero, LiveView, Scrolly, Stat, Stats }

export const blockComponents = {
  dcHero: Hero,
  dcLiveView: LiveView,
  dcStats: Stats,
  dcFigure: Figure,
  dcScrolly: Scrolly,
  dcStat: Stat,
  dcGuess: Guess,
  dcExplorer: Explorer,
} as const
