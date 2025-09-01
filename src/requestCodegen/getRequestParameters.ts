import { IParameter, ISwaggerSource } from '../swaggerInterfaces'

import { refClassName, toBaseType, RemoveSpecialCharacters, derefParameter } from '../utils'

import camelcase from 'camelcase'

/**
 * 参数去重
 * 后台书写不规范,存在参数重名的情况
 * @param params
 */
function getUniqParams(params: IParameter[]): IParameter[] {
  const uniqParams: Record<string, IParameter> = {}
  params.forEach(v => {
    // _${v.in}
    // TODO:同名但是v.in= query |path |body 的情况同时出现如何处理？分出不同的request参数？
    if ('$ref' in (v as IParameter) && !('name' in (v as IParameter))) {
      v.name = refClassName(v.$ref)
    }
    if (!v.name.includes('[0]')) {
      //DTO class中存在List<T>时会出现这种参数 (list[0].prop)
      uniqParams[`${v.name}`] = v
    }
  })
  return Object.values(uniqParams)
}

/**
 * 生成参数
 * @param params
 */
export function getRequestParameters(params: IParameter[], useHeaderParameters: boolean, source: ISwaggerSource) {
  params = getUniqParams(params)
  let requestParameters = ''
  let requestFormData = ''
  let requestPathReplace = ''
  let queryParameters: string[] = []
  let bodyParameters: string[] = []
  let headerParameters: string[] = []
  let imports: string[] = []
  let moreBodyParams = params.filter(item => item.in === 'body').length > 1
  params.forEach(p => {
    const ref = derefParameter(p, source)

    // 根据设置跳过请求头中的参数
    if (!useHeaderParameters && ref.in === 'header') return
    let propType = ''
    // 引用类型定义
    if (ref.schema) {
      if (ref.schema.items) {
        propType = refClassName(ref.schema.items.$ref)
        if (ref.schema.type && ref.schema.type === 'array') {
          propType += '[]'
        }
      } else if (ref.schema.$ref) {
        propType = refClassName(ref.schema.$ref)
        // console.log('propType', refClassName(p.schema.$ref))
      } else if (ref.schema.type) {
        propType = toBaseType(ref.schema.type)
      } else {
        throw new Error('Could not find property type on schema')
      }
      imports.push(propType)
    } else if (ref.items) {
      propType = ref.items.$ref ? refClassName(ref.items.$ref) + '[]' : toBaseType(ref.items.type, ref.items?.format) + '[]'
      imports.push(propType)
    }
    // 基本类型
    else {
      propType = toBaseType(ref.type, ref?.format)
    }

    const paramName = camelcase(ref.name)
    requestParameters += `
    /** ${ref.description || ''} */
    ${paramName}${ref.required ? '' : '?'}:${propType},`

    // 如果参数是从formData 提交
    if (ref.in === 'formData') {
      requestFormData += `if(params['${paramName}']){
        if(Object.prototype.toString.call(params['${paramName}']) === '[object Array]'){
          for (const item of params['${paramName}']) {
            data.append('${ref.name}',item as any)
          }
        } else {
          data.append('${ref.name}',params['${paramName}'] as any)
        }
      }\n
      `
    } else if (ref.in === 'path') {
      requestPathReplace += `url = url.replace('{${ref.name}}',params['${paramName}']+'')\n`
    } else if (ref.in === 'query') {
      queryParameters.push(`'${ref.name}':params['${paramName}']`)
    } else if (ref.in === 'body') {
      const body = moreBodyParams ? `'${ref.name}':params['${paramName}']` : `params['${paramName}']`

      // var body = p.schema
      //   ? p.schema.type === 'array'
      //     ? `[...params['${paramName}']]`
      //     : `...params['${paramName}']`
      //   : `'${p.name}':params['${paramName}']`
      bodyParameters.push(body)
    } else if (ref.in === 'header') {
      headerParameters.push(`'${ref.name}':params['${paramName}']`)
    }
  })
  const bodyParameter = moreBodyParams ? `{${bodyParameters.join(',')}}` : bodyParameters.join(',')
  return {
    requestParameters,
    requestFormData,
    requestPathReplace,
    queryParameters,
    bodyParameter,
    headerParameters,
    imports
  }
}
