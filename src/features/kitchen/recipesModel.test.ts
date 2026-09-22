import { describe, expect, it } from 'vitest'
import type { Recipe, RecipeLine } from '@/data/snapshot'
import {
  INGREDIENT_LIMIT_MESSAGE, MAX_INGREDIENTS, MAX_NOTES, MAX_STEPS, MAX_TITLE, SEARCH_THRESHOLD,
  buildRecipesModel, cleanLine, cleanNotes, cleanServings, ingredientsLabel, limitNotice, lineTexts, matches,
  moveLine, recipeErrorMessage, servingsLabel, trimLines, visibleRecipes,
} from './recipesModel'

const line = (id: string, text: string, sort: number): RecipeLine => ({ id, text, sort })

const recipe = (id: string, title: string, createdAt: string, over: Partial<Recipe> = {}): Recipe => ({
  id,
  title,
  sourceUrl: null,
  servings: 4,
  notes: null,
  createdAt,
  archivedAt: null,
  ingredients: [line(`${id}-1`, 'Salt', 0)],
  steps: [],
  ...over,
})

const TACOS = recipe('r-tacos', 'Weeknight tacos', '2026-08-01T00:00:00.000Z')
const SHEET = recipe('r-sheet', 'Sheet-pan chicken', '2026-09-01T00:00:00.000Z', {
  ingredients: [line('s-1', 'Chicken', 0), line('s-2', 'Potatoes', 1)],
})
const GONE = recipe('r-gone', 'Old soup', '2026-09-05T00:00:00.000Z', { archivedAt: '2026-09-06T00:00:00.000Z' })

describe('visibleRecipes', () => {
  it('leaves out archived ones and puts the newest first', () => {
    expect(visibleRecipes([TACOS, GONE, SHEET]).map((r) => r.id)).toEqual(['r-sheet', 'r-tacos'])
  })

  it('copes with a snapshot from before the Kitchen screen', () => {
    expect(visibleRecipes(undefined)).toEqual([])
  })
})

describe('matches', () => {
  it('matches the title, ignoring case and surrounding space', () => {
    expect(matches(TACOS, 'taco')).toBe(true)
    expect(matches(TACOS, '  TACO ')).toBe(true)
    expect(matches(TACOS, '')).toBe(true)
    expect(matches(TACOS, 'chicken')).toBe(false)
  })

  it('does not search the ingredients', () => {
    expect(matches(SHEET, 'potatoes')).toBe(false)
  })
})

describe('buildRecipesModel', () => {
  it('builds a card per un-archived recipe, newest first', () => {
    const model = buildRecipesModel([TACOS, GONE, SHEET], '')
    expect(model.cards).toEqual([
      { id: 'r-sheet', title: 'Sheet-pan chicken', ingredientCount: 2, servings: 4 },
      { id: 'r-tacos', title: 'Weeknight tacos', ingredientCount: 1, servings: 4 },
    ])
    expect(model.total).toBe(2)
    expect(model.canAddRecipe).toBe(true)
  })

  it('narrows to the search but still counts the whole box', () => {
    const model = buildRecipesModel([TACOS, SHEET], 'taco')
    expect(model.cards.map((c) => c.id)).toEqual(['r-tacos'])
    expect(model.total).toBe(2)
  })

  it('shows the search field only past twelve recipes', () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_u, i) => recipe(`r-${i}`, `Recipe ${i}`, `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`))
    expect(buildRecipesModel(many(SEARCH_THRESHOLD), '').showSearch).toBe(false)
    expect(buildRecipesModel(many(SEARCH_THRESHOLD + 1), '').showSearch).toBe(true)
  })
})

describe('the field helpers', () => {
  it('counts ingredients in words', () => {
    expect(ingredientsLabel(5)).toBe('5 ingredients')
    expect(ingredientsLabel(1)).toBe('1 ingredient')
    expect(ingredientsLabel(0)).toBe('0 ingredients')
  })

  it('labels servings, or says nothing', () => {
    expect(servingsLabel(4)).toBe('Serves 4')
    expect(servingsLabel(null)).toBeNull()
  })

  it('reads a recipe\'s lines in their saved order', () => {
    expect(lineTexts([line('b', 'Second', 1), line('a', 'First', 0)])).toEqual(['First', 'Second'])
  })

  it('trims, collapses and caps a line', () => {
    expect(cleanLine('  two   words ', MAX_TITLE)).toBe('two words')
    expect(cleanLine('x'.repeat(200), MAX_TITLE)).toHaveLength(MAX_TITLE)
  })

  it('keeps line breaks in the notes and empties to null', () => {
    expect(cleanNotes('  one\ntwo  ')).toBe('one\ntwo')
    expect(cleanNotes('   ')).toBeNull()
    expect(cleanNotes('x'.repeat(MAX_NOTES + 50))).toHaveLength(MAX_NOTES)
  })

  it('reads servings as 1-99, or nothing', () => {
    expect(cleanServings('4')).toBe(4)
    expect(cleanServings(' 120 ')).toBe(99)
    expect(cleanServings('0')).toBeNull()
    expect(cleanServings('')).toBeNull()
    expect(cleanServings('lots')).toBeNull()
  })
})

describe('the limits', () => {
  it('names the limit a recipe is already at', () => {
    expect(limitNotice(3, 2)).toBeNull()
    expect(limitNotice(MAX_INGREDIENTS, 2)).toBe(INGREDIENT_LIMIT_MESSAGE)
    expect(limitNotice(3, MAX_STEPS)).toBe('A recipe holds 40 steps.')
  })

  it('drops empty lines and caps the count before a save', () => {
    expect(trimLines(['  Salt ', '', '  ', 'Pepper'], 50, 100)).toEqual(['Salt', 'Pepper'])
    expect(trimLines(Array.from({ length: 60 }, (_u, i) => `Line ${i}`), MAX_INGREDIENTS, 100)).toHaveLength(MAX_INGREDIENTS)
  })
})

describe('recipeErrorMessage', () => {
  it('says something an adult can act on, never the server\'s words', () => {
    expect(recipeErrorMessage('denied')).toBe("You can't change this recipe.")
    expect(recipeErrorMessage('invalid')).toContain('50 ingredients')
    expect(recipeErrorMessage('network')).toBe('No connection — try again.')
    expect(recipeErrorMessage('other')).toBe('Something went wrong.')
  })
})

describe('moveLine', () => {
  it('swaps a line with its neighbour', () => {
    expect(moveLine(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c'])
    expect(moveLine(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b'])
  })

  it('leaves the ends alone', () => {
    expect(moveLine(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(moveLine(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
    expect(moveLine(['a', 'b'], 5, 1)).toEqual(['a', 'b'])
  })
})
