import { ServicePage } from "@/components/site/ServicePage";
import { useServiceContent } from "@/lib/service-content";
import { ShieldCheck } from "lucide-react";

const CustomSolutions = () => {
 const {c,service,details,props}=useServiceContent();
 return (
  <ServicePage {...props} />
);
};
export default CustomSolutions;
