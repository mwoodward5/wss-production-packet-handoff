import { projects as boundProjects } from "./bridge";
export type ProjectCategory = string;
export interface Project {src:string;alt:string;caption:string;orientation:"portrait"|"landscape";categories:string[]}
export const projects: Project[] = boundProjects;
export const featuredProjects = projects.slice(0,6);
export const projectCategories: {key:string;label:string}[] = [];
export const projectsByCategory = (cat: string) => projects.filter(p=>p.categories.includes(cat));
