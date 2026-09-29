import ReactMarkdown from 'react-markdown';

// Copy cannot create additional media slots. Photos belong to the certified
// hero/gallery bindings, whose crop and order are controlled by the donor JSX.
export function CertifiedMarkdown({children}:{children:string}) {
 return <ReactMarkdown skipHtml disallowedElements={['img']}>{children}</ReactMarkdown>;
}
