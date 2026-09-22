import { describe, expect, it } from 'vitest'
import type { MealPlanEntry, Recipe } from '@/data/snapshot'
import {
  MAX_MEAL_TEXT, buildMealsModel, cleanMealText, dateLabel, mealDays, plannedFor, weekdayLabel,
} from './mealsModel'

const TODAY = '2026-09-14'

const recipe = (id: string, title: string, archivedAt: string | null = null): Recipe => ({
  id,
  title,
  sourceUrl: null,
  servings: null,
  notes: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  archivedAt,
  ingredients: [],
  steps: [],
})

const entry = (day: string, text: string, recipeId: string | null = null): MealPlanEntry => ({
  id: `meal-${day}`, day, text, recipeId, createdAt: '2026-09-10T00:00:00.000Z',
})

describe('mealDays', () => {
  it('runs today first, then the next six days', () => {
    expect(mealDays(TODAY)).toEqual([
      '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20',
    ])
  })

  it('crosses a month end without a local time shift', () => {
    expect(mealDays('2026-09-28')).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    ])
  })
})

describe('the day labels', () => {
  it('names the weekday and the date', () => {
    expect(weekdayLabel('2026-09-14')).toBe('Monday')
    expect(dateLabel('2026-09-14')).toBe('Sep 14')
    expect(weekdayLabel('2026-09-20')).toBe('Sunday')
  })
})

describe('plannedFor', () => {
  const recipes = [recipe('r-tacos', 'Weeknight tacos')]

  it('reads the entry for the day, and nothing for an unplanned one', () => {
    const plan = [entry(TODAY, 'Leftovers')]
    expect(plannedFor(plan, recipes, TODAY)).toEqual({ text: 'Leftovers', recipeId: null })
    expect(plannedFor(plan, recipes, '2026-09-15')).toBeNull()
  })

  it('shows the entry\'s own label, recipe or not', () => {
    const plan = [entry(TODAY, 'Tacos', 'r-tacos')]
    expect(plannedFor(plan, recipes, TODAY)).toEqual({ text: 'Tacos', recipeId: 'r-tacos' })
  })

  it('keeps the label when the recipe is gone, so archiving never empties a plan', () => {
    const plan = [entry(TODAY, 'Tacos', 'r-tacos')]
    expect(plannedFor(plan, [], TODAY)).toEqual({ text: 'Tacos', recipeId: 'r-tacos' })
  })

  it('falls back to the recipe box for a row written without a label', () => {
    const plan = [entry(TODAY, '', 'r-tacos')]
    expect(plannedFor(plan, recipes, TODAY)).toEqual({ text: 'Weeknight tacos', recipeId: 'r-tacos' })
    expect(plannedFor(plan, [], TODAY)).toBeNull()
  })

  it('copes with a snapshot from before the Kitchen screen', () => {
    expect(plannedFor(undefined, undefined, TODAY)).toBeNull()
  })
})

describe('buildMealsModel', () => {
  it('returns seven cards with today first and marked', () => {
    const cards = buildMealsModel([entry(TODAY, 'Tacos', 'r-tacos')], [recipe('r-tacos', 'Weeknight tacos')], TODAY)
    expect(cards).toHaveLength(7)
    expect(cards[0]).toEqual({
      day: TODAY,
      weekdayLabel: 'Today',
      dateLabel: 'Sep 14',
      planned: { text: 'Tacos', recipeId: 'r-tacos' },
      isToday: true,
    })
    expect(cards.slice(1).every((card) => !card.isToday)).toBe(true)
    expect(cards[1]).toMatchObject({ day: '2026-09-15', weekdayLabel: 'Tuesday', planned: null })
  })

  it('ignores entries outside the week, including yesterday', () => {
    const cards = buildMealsModel([entry('2026-09-13', 'Soup'), entry('2026-09-30', 'Pizza')], [], TODAY)
    expect(cards.every((card) => card.planned === null)).toBe(true)
  })
})

describe('cleanMealText', () => {
  it('trims, collapses and caps', () => {
    expect(cleanMealText('  chicken   pot pie ')).toBe('chicken pot pie')
    expect(cleanMealText('   ')).toBe('')
    expect(cleanMealText('x'.repeat(200))).toHaveLength(MAX_MEAL_TEXT)
  })
})
