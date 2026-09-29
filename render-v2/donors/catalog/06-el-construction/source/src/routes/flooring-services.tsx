import {createFileRoute} from '@tanstack/react-router';
import {BoundService} from '@/components/BoundService';
export const Route=createFileRoute('/flooring-services')({component:()=> <BoundService slug="flooring-services"/>});
