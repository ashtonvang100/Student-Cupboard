export type Product = {id:string; name:string; category:string; image:string; quantity:number; updatedAt:string|null; inventoryId?:number; inventoryUpdatedAt?:string|null; unclear?:boolean; nutrition:null|{calories:number|null;protein:number|null;carbs:number|null;fat:number|null}; serving:string; description:string};
export const photo = (id:string,w=700) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=85`;
export const images = {
 fruit:photo('photo-1619566636858-adf3ef46400b'),
 vegetables:photo('photo-1540420773420-3366772f4999'),
 bread:photo('photo-1509440159596-0249088772ff'),
 milk:photo('photo-1563636619-e9143da7973b'),
 snacks:photo('photo-1517673400267-0251440c45dc'),
 drinks:photo('photo-1600271886742-f049cd451bba'),
 hero:photo('photo-1542838132-92c53300491e',1200),
 oats:photo('photo-1517673400267-0251440c45dc'),
};
const recent = new Date().toISOString();
export const demoProducts:Product[] = [
 {id:'apples',name:'Fresh apples',category:'Fruit',image:images.fruit,quantity:24,updatedAt:recent,nutrition:{calories:95,protein:0.5,carbs:25,fat:0.3},serving:'1 medium apple',description:'A crisp little pick-me-up between classes. Enjoy on its own or slice into a bowl of oats.'},
 {id:'oats',name:'Old-fashioned oats',category:'Snacks',image:images.oats,quantity:12,updatedAt:recent,nutrition:{calories:150,protein:5,carbs:27,fat:3},serving:'½ cup dry',description:'A versatile pantry staple for a warm breakfast or easy overnight oats.'},
 {id:'bread',name:'Whole wheat bread',category:'Bread',image:images.bread,quantity:8,updatedAt:recent,nutrition:{calories:80,protein:4,carbs:14,fat:1},serving:'1 slice',description:'Build a quick sandwich or make a simple slice of toast before class.'},
 {id:'greens',name:'Fresh salad greens',category:'Vegetables',image:images.vegetables,quantity:9,updatedAt:recent,nutrition:{calories:15,protein:1,carbs:3,fat:0},serving:'2 cups',description:'Add a little freshness to lunch with a simple salad or a handful of greens in a sandwich.'},
 {id:'milk',name:'Low-fat milk',category:'Milk',image:images.milk,quantity:0,updatedAt:recent,nutrition:{calories:100,protein:8,carbs:12,fat:2.5},serving:'1 cup',description:'A familiar fridge staple. Check availability before planning your visit.'},
 {id:'juice',name:'Orange juice',category:'Drinks',image:images.drinks,quantity:4,updatedAt:null,nutrition:null,serving:'Not recorded',description:'Availability needs a new shelf update. Nutrition information has not been recorded.'},
];
export const categories = ['Fruit','Vegetables','Bread','Milk','Snacks','Drinks'];
export const categoryImages:Record<string,string> = {Fruit:images.fruit,Vegetables:images.vegetables,Bread:images.bread,Milk:images.milk,Snacks:images.snacks,Drinks:images.drinks};
