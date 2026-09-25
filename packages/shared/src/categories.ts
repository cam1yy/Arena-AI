/**
 * Common local-business categories offered as quick picks in Discover and
 * onboarding. Each entry is sent to Places API Text Search as a plain text
 * query, so users can also type any custom keyword.
 */
export interface BusinessCategory {
  id: string;
  label: string;
  query: string;
  group: 'Trades' | 'Beauty' | 'Food' | 'Health' | 'Automotive' | 'Services' | 'Retail' | 'Professional';
}

export const BUSINESS_CATEGORIES: BusinessCategory[] = [
  { id: 'plumbers', label: 'Plumbers', query: 'plumbers', group: 'Trades' },
  { id: 'electricians', label: 'Electricians', query: 'electricians', group: 'Trades' },
  { id: 'roofing', label: 'Roofing contractors', query: 'roofing contractors', group: 'Trades' },
  { id: 'painters', label: 'Painters', query: 'house painters', group: 'Trades' },
  { id: 'builders', label: 'Builders', query: 'building contractors', group: 'Trades' },
  { id: 'landscapers', label: 'Landscapers', query: 'landscaping services', group: 'Trades' },
  { id: 'locksmiths', label: 'Locksmiths', query: 'locksmiths', group: 'Trades' },
  { id: 'pest-control', label: 'Pest control', query: 'pest control services', group: 'Trades' },
  { id: 'barbers', label: 'Barbers', query: 'barbers', group: 'Beauty' },
  { id: 'hair-salons', label: 'Hair salons', query: 'hair salons', group: 'Beauty' },
  { id: 'nail-salons', label: 'Nail salons', query: 'nail salons', group: 'Beauty' },
  { id: 'beauty-salons', label: 'Beauty salons', query: 'beauty salons', group: 'Beauty' },
  { id: 'tattoo', label: 'Tattoo studios', query: 'tattoo studios', group: 'Beauty' },
  { id: 'restaurants', label: 'Restaurants', query: 'restaurants', group: 'Food' },
  { id: 'cafes', label: 'Cafes', query: 'cafes', group: 'Food' },
  { id: 'bakeries', label: 'Bakeries', query: 'bakeries', group: 'Food' },
  { id: 'caterers', label: 'Caterers', query: 'catering services', group: 'Food' },
  { id: 'food-trucks', label: 'Food trucks', query: 'food trucks', group: 'Food' },
  { id: 'gyms', label: 'Gyms', query: 'gyms', group: 'Health' },
  { id: 'personal-trainers', label: 'Personal trainers', query: 'personal trainers', group: 'Health' },
  { id: 'physiotherapists', label: 'Physiotherapists', query: 'physiotherapists', group: 'Health' },
  { id: 'dentists', label: 'Dentists', query: 'dentists', group: 'Health' },
  { id: 'vets', label: 'Veterinarians', query: 'veterinarians', group: 'Health' },
  { id: 'auto-repair', label: 'Auto repair', query: 'auto repair shops', group: 'Automotive' },
  { id: 'car-wash', label: 'Car wash', query: 'car wash', group: 'Automotive' },
  { id: 'tyres', label: 'Tyre shops', query: 'tyre shops', group: 'Automotive' },
  { id: 'panel-beaters', label: 'Panel beaters', query: 'panel beaters auto body shops', group: 'Automotive' },
  { id: 'cleaning', label: 'Cleaning services', query: 'cleaning services', group: 'Services' },
  { id: 'movers', label: 'Moving companies', query: 'moving companies', group: 'Services' },
  { id: 'laundry', label: 'Laundromats', query: 'laundromats', group: 'Services' },
  { id: 'pet-grooming', label: 'Pet grooming', query: 'pet grooming', group: 'Services' },
  { id: 'photographers', label: 'Photographers', query: 'photographers', group: 'Services' },
  { id: 'driving-schools', label: 'Driving schools', query: 'driving schools', group: 'Services' },
  { id: 'florists', label: 'Florists', query: 'florists', group: 'Retail' },
  { id: 'hardware', label: 'Hardware stores', query: 'hardware stores', group: 'Retail' },
  { id: 'boutiques', label: 'Clothing boutiques', query: 'clothing boutiques', group: 'Retail' },
  { id: 'accountants', label: 'Accountants', query: 'accountants', group: 'Professional' },
  { id: 'lawyers', label: 'Lawyers', query: 'law firms', group: 'Professional' },
  { id: 'real-estate', label: 'Real estate agents', query: 'real estate agents', group: 'Professional' },
  { id: 'tutors', label: 'Tutors', query: 'tutoring services', group: 'Professional' },
];

export function categoryLabel(idOrQuery: string): string {
  const match = BUSINESS_CATEGORIES.find((c) => c.id === idOrQuery || c.query === idOrQuery);
  return match ? match.label : idOrQuery;
}
