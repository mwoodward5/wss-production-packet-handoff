import {createFileRoute} from '@tanstack/react-router';
import {BoundService} from '@/components/BoundService';
export const Route=createFileRoute('/home-renovation')({component:()=> <BoundService slug="home-renovation"/>});
